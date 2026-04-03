/** Gateway operational state — mirrors BAIF ONLINE/LIMBO/OFFLINE/UNKNOWN */
export type GatewayState = "ONLINE" | "LIMBO" | "OFFLINE" | "UNKNOWN";

/** Gateway configuration */
export interface GatewayConfig {
  host: string;
  port: number;
  state: GatewayState;
  channels: string[];
  entityStorePath?: string;
  coaStorePath?: string;
}
