// app/api/approve/[id]/route.ts
import { createServerClient } from '@/lib/supabase'

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServerClient()

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'approved' })
    .eq('id', id)
    .eq('status', 'pending')

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true }, { status: 200 })
}
