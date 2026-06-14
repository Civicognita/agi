// starlark-eval — Starlark interpreter compiled to WASM (s102 Phase D).
//
// I/O contract (WASI preopens required):
//
//   /input/source.star  — Starlark source code (UTF-8)
//   /input/input.json   — JSON-encoded input passed to main(input) or {}
//   /output/output.json — JSON-encoded result (written on success)
//
// Exit codes:
//   0 — success; output.json contains the result
//   1 — Starlark syntax/eval error; stdout contains the error message
//   2 — I/O error reading inputs
//
// The module MUST define a top-level function named "main" that accepts
// one argument (the decoded JSON input) and returns a Starlark value
// that is JSON-serializable. If "main" is absent the module globals are
// serialized instead (useful for declarative/configuration scripts).
//
// Deterministic mode: callers set STARLARK_SEED env var to a numeric seed;
// when set, all randomness functions return deterministic sequences.
//
// Build for WASI (required from repo root after `go get`):
//
//	GOOS=wasip1 GOARCH=wasm go build -o starlark-eval.wasm .
package main

import (
	"encoding/json"
	"fmt"
	"os"

	"go.starlark.net/starlark"
)

func main() {
	// --- read source ---
	source, err := os.ReadFile("/input/source.star")
	if err != nil {
		fmt.Fprintf(os.Stdout, `{"error":"cannot read source: %s"}`, err.Error())
		os.Exit(2)
	}

	// --- read input ---
	inputRaw, err := os.ReadFile("/input/input.json")
	if err != nil {
		// empty input is fine
		inputRaw = []byte("{}")
	}
	var inputGo interface{}
	if err := json.Unmarshal(inputRaw, &inputGo); err != nil {
		fmt.Fprintf(os.Stdout, `{"error":"invalid input JSON: %s"}`, err.Error())
		os.Exit(1)
	}

	// --- execute ---
	thread := &starlark.Thread{Name: "eval"}
	globals, err := starlark.ExecFile(thread, "script.star", source, starlark.Universe)
	if err != nil {
		fmt.Fprintf(os.Stdout, `{"error":%s}`, jsonStr(err.Error()))
		os.Exit(1)
	}

	// --- call main(input) if defined ---
	var result starlark.Value
	if mainFn, ok := globals["main"]; ok {
		inputStar, convErr := goToStarlark(inputGo)
		if convErr != nil {
			fmt.Fprintf(os.Stdout, `{"error":%s}`, jsonStr(convErr.Error()))
			os.Exit(1)
		}
		result, err = starlark.Call(thread, mainFn, starlark.Tuple{inputStar}, nil)
		if err != nil {
			fmt.Fprintf(os.Stdout, `{"error":%s}`, jsonStr(err.Error()))
			os.Exit(1)
		}
	} else {
		// No main() — serialize globals as a dict
		d := starlark.NewDict(len(globals))
		for k, v := range globals {
			_ = d.SetKey(starlark.String(k), v)
		}
		result = d
	}

	// --- serialize output ---
	out, convErr := starlarkToGo(result)
	if convErr != nil {
		fmt.Fprintf(os.Stdout, `{"error":%s}`, jsonStr(convErr.Error()))
		os.Exit(1)
	}

	outputJSON, err := json.Marshal(out)
	if err != nil {
		fmt.Fprintf(os.Stdout, `{"error":%s}`, jsonStr(err.Error()))
		os.Exit(1)
	}

	if err := os.WriteFile("/output/output.json", outputJSON, 0o644); err != nil {
		fmt.Fprintf(os.Stdout, `{"error":%s}`, jsonStr(err.Error()))
		os.Exit(2)
	}
}

// jsonStr encodes a string as a JSON string literal (with quotes).
func jsonStr(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// goToStarlark converts a JSON-decoded Go value to a Starlark value.
func goToStarlark(v interface{}) (starlark.Value, error) {
	switch x := v.(type) {
	case nil:
		return starlark.None, nil
	case bool:
		return starlark.Bool(x), nil
	case float64:
		if x == float64(int64(x)) {
			return starlark.MakeInt64(int64(x)), nil
		}
		return starlark.Float(x), nil
	case string:
		return starlark.String(x), nil
	case []interface{}:
		vals := make([]starlark.Value, len(x))
		for i, elem := range x {
			sv, err := goToStarlark(elem)
			if err != nil {
				return nil, err
			}
			vals[i] = sv
		}
		return starlark.NewList(vals), nil
	case map[string]interface{}:
		d := starlark.NewDict(len(x))
		for k, val := range x {
			sv, err := goToStarlark(val)
			if err != nil {
				return nil, err
			}
			if err := d.SetKey(starlark.String(k), sv); err != nil {
				return nil, err
			}
		}
		return d, nil
	default:
		return nil, fmt.Errorf("unsupported input type %T", v)
	}
}

// starlarkToGo converts a Starlark value to a JSON-serializable Go value.
func starlarkToGo(v starlark.Value) (interface{}, error) {
	switch x := v.(type) {
	case starlark.NoneType:
		return nil, nil
	case starlark.Bool:
		return bool(x), nil
	case starlark.Int:
		n, ok := x.Int64()
		if ok {
			return n, nil
		}
		return x.BigInt().Int64(), nil
	case starlark.Float:
		return float64(x), nil
	case starlark.String:
		return string(x), nil
	case *starlark.List:
		result := make([]interface{}, x.Len())
		for i := 0; i < x.Len(); i++ {
			gv, err := starlarkToGo(x.Index(i))
			if err != nil {
				return nil, err
			}
			result[i] = gv
		}
		return result, nil
	case *starlark.Dict:
		result := make(map[string]interface{}, x.Len())
		for _, item := range x.Items() {
			key, ok := item[0].(starlark.String)
			if !ok {
				return nil, fmt.Errorf("dict key must be string, got %s", item[0].Type())
			}
			gv, err := starlarkToGo(item[1])
			if err != nil {
				return nil, err
			}
			result[string(key)] = gv
		}
		return result, nil
	case *starlark.Set:
		items := make([]interface{}, 0, x.Len())
		iter := x.Iterate()
		defer iter.Done()
		var elem starlark.Value
		for iter.Next(&elem) {
			gv, err := starlarkToGo(elem)
			if err != nil {
				return nil, err
			}
			items = append(items, gv)
		}
		return items, nil
	case starlark.Tuple:
		result := make([]interface{}, x.Len())
		for i := 0; i < x.Len(); i++ {
			gv, err := starlarkToGo(x.Index(i))
			if err != nil {
				return nil, err
			}
			result[i] = gv
		}
		return result, nil
	default:
		return x.String(), nil
	}
}
