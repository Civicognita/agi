import { createPlugin } from "@aionima/sdk";
import { registerAllWorkers } from "./register.js";

export default createPlugin({
  async activate(api) {
    registerAllWorkers(api);
  },
});
