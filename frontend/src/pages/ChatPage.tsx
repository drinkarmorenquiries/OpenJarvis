import { ChatArea } from '../components/Chat/ChatArea';
import { ConnectionGate } from '../components/Chat/ConnectionGate';
import { SystemPanel } from '../components/Chat/SystemPanel';
import { useAppStore } from '../lib/store';

export function ChatPage() {
  const systemPanelOpen = useAppStore((s) => s.systemPanelOpen);

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 min-w-0">
        <ConnectionGate><ChatArea /></ConnectionGate>
      </div>
      {systemPanelOpen && <SystemPanel />}
    </div>
  );
}
