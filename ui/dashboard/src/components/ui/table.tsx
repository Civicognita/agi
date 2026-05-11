/**
 * Table — re-exported from react-fancy Table component.
 */

import { Table } from "@particle-academy/react-fancy";

const TableHeader = Table.Head;
const TableBody = Table.Body;
const TableRow = Table.Row;
const TableHead = Table.Column;
const TableCell = Table.Cell;

// Note: `Table.Footer` was removed in a newer @particle-academy/react-fancy
// release. No consumers reference the previously-exported `TableFooter`, so
// the re-export is dropped (rather than substituting a hand-rolled <tfoot>).

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
