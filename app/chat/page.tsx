// app/chat/page.tsx
import { ChatWindow } from '@/components/chat-window'

export default function ChatPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-8 py-5 border-b border-slate-200 bg-white">
        <h1 className="text-2xl font-bold text-slate-900">Chat</h1>
        <p className="text-sm text-slate-500 mt-0.5">Ask questions about your approved invoices.</p>
      </div>
      <div className="flex-1 min-h-0">
        <ChatWindow />
      </div>
    </div>
  )
}
