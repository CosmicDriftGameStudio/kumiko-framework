import { type ReactNode, useState } from "react";
import { useTranslation } from "../../index.ts";
import { DefaultTabs } from "../primitives/tabs.tsx";
import { MessageThread } from "./message-thread.tsx";
import type { MessageReaderProps } from "./message-types.ts";

const MAIL_TAB_ID = "mail";

/** Mail thread with an optional tab per attachment; the tab bar only exists when there are attachment tabs. */
export function MessageReader({
  thread,
  attachmentTabs = [],
  activeTabId,
  onTabChange,
  testId = "message-reader",
}: MessageReaderProps): ReactNode {
  const t = useTranslation();
  const [uncontrolledTabId, setUncontrolledTabId] = useState(MAIL_TAB_ID);
  const currentTabId = activeTabId ?? uncontrolledTabId;
  const activeTab = attachmentTabs.find((tab) => tab.id === currentTabId);

  const selectTab = (id: string) => {
    setUncontrolledTabId(id);
    onTabChange?.(id);
  };

  return (
    <div data-testid={testId} className="flex flex-col gap-4">
      {attachmentTabs.length > 0 && (
        <DefaultTabs
          items={[
            { id: MAIL_TAB_ID, label: t("kumiko.widget.message-reader.mail") },
            ...attachmentTabs.map((tab) => ({ id: tab.id, label: tab.label })),
          ]}
          activeId={activeTab === undefined ? MAIL_TAB_ID : currentTabId}
          onSelect={selectTab}
        />
      )}
      {activeTab === undefined ? <MessageThread {...thread} /> : activeTab.render()}
    </div>
  );
}
