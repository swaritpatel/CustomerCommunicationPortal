import { Suspense } from "react";

import { WidgetChatClient } from "@/modules/chat/components/widget-chat-client";

export default function WidgetEmbedPage() {
  return (
    <Suspense>
      <WidgetChatClient />
    </Suspense>
  );
}
