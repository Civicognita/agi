import { ChannelPage } from "@/components/ChannelPage.js";
import { PageScroll } from "@/components/PageScroll.js";

export default function CommsTelegramPage() {
  return <PageScroll><ChannelPage channelId="telegram" channelName="Telegram" /></PageScroll>;
}
