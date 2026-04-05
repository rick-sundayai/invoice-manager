// components/chat-window.tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChatResults } from '@/components/chat-results'
import type { DataBlock } from '@/lib/chat'

type Message = {
  role: 'user' | 'assistant'
  text: string
}

export function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([])
  const [data, setData] = useState<DataBlock | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    const message = input.trim()
    if (!message || loading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: message }])
    setLoading(true)

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })

    const json = await res.json() as { text: string; data: DataBlock | null }
    setMessages(prev => [...prev, { role: 'assistant', text: json.text }])
    setData(json.data)
    setLoading(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') send()
  }

  return (
    <div className="flex h-full">
      {/* Conversation panel */}
      <div className="flex flex-col flex-1 border-r border-slate-200">
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <p className="text-slate-400 text-sm">Ask anything about your invoices.</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-900'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-400">
                Thinking…
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="p-4 border-t border-slate-200 flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your invoices..."
            disabled={loading}
            className="flex-1"
          />
          <Button onClick={send} disabled={loading || !input.trim()}>
            Send
          </Button>
        </div>
      </div>

      {/* Results panel */}
      <div className="w-64 shrink-0 bg-slate-50 overflow-y-auto">
        <ChatResults data={data} />
      </div>
    </div>
  )
}
