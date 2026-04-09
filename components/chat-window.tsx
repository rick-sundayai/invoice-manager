// components/chat-window.tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChatResults } from '@/components/chat-results'
import type { DataBlock } from '@/lib/chat'
import type { ConversationMessage } from '@/lib/chat'

type Message = {
  role: 'user' | 'assistant' | 'error'
  text: string
}

const SUGGESTED_PROMPTS = [
  'What did I spend last month?',
  'Show me all Google invoices',
  'What was my largest invoice?',
  'Total spend by vendor',
]

export function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([])
  const [data, setData] = useState<DataBlock | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(overrideMessage?: string) {
    const message = (overrideMessage ?? input).trim()
    if (!message || loading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: message }])
    setLoading(true)

    const history: ConversationMessage[] = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', text: m.text }))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
      })

      const json = await res.json() as { text?: string; data?: DataBlock | null; error?: string }

      if (!res.ok || json.error) {
        setMessages(prev => [
          ...prev,
          { role: 'error', text: json.error ?? 'Something went wrong. Please try again.' },
        ])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', text: json.text ?? '' }])
        setData(json.data ?? null)
      }
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'error', text: 'Network error. Please try again.' },
      ])
    } finally {
      setLoading(false)
    }
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
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <p className="text-slate-400 text-sm">Ask anything about your invoices.</p>
              <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                {SUGGESTED_PROMPTS.map(prompt => (
                  <button
                    key={prompt}
                    onClick={() => send(prompt)}
                    disabled={loading}
                    className="text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            if (msg.role === 'user') {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] rounded-xl px-4 py-2 text-sm bg-blue-600 text-white">
                    {msg.text}
                  </div>
                </div>
              )
            }

            if (msg.role === 'error') {
              return (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[80%] rounded-xl px-4 py-2 text-sm bg-red-50 border border-red-200 text-red-600">
                    {msg.text}
                  </div>
                </div>
              )
            }

            return (
              <div key={i} className="flex justify-start">
                <div className="max-w-[80%] rounded-xl px-4 py-2 text-sm bg-white border border-slate-200 text-slate-900">
                  <div className="[&_p:not(:last-child)]:mb-2 [&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4 [&_li]:mb-0.5 [&_strong]:font-semibold">
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                  </div>
                </div>
              </div>
            )
          })}

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
          <Button onClick={() => send()} disabled={loading || !input.trim()}>
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
