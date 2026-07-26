import { Suspense } from "react";

import { WidgetChatClient } from "@/modules/chat/components/widget-chat-client";

export default function WidgetChatPage() {
  return (
    <Suspense>
      <WidgetChatClient previewMode />
    </Suspense>
  );
}
