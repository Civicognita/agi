import { ChannelPage } from "@/components/ChannelPage.js";
import { PageScroll } from "@/components/PageScroll.js";

export default function CommsDiscordPage() {
  return <PageScroll><ChannelPage channelId="discord" channelName="Discord" /></PageScroll>;
}
