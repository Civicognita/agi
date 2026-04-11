import { ChannelPage } from "@/components/ChannelPage.js";
import { PageScroll } from "@/components/PageScroll.js";

export default function CommsSignalPage() {
  return <PageScroll><ChannelPage channelId="signal" channelName="Signal" /></PageScroll>;
}
