
-- Wipe legacy public messages and their reads (schema change to private DMs)
DELETE FROM public.message_reads;
DELETE FROM public.messages;

ALTER TABLE public.messages
  ADD COLUMN recipient_id uuid NOT NULL;

CREATE INDEX messages_pair_idx ON public.messages (sender_id, recipient_id, created_at);
CREATE INDEX messages_recipient_idx ON public.messages (recipient_id, created_at);

-- Tighten messages RLS to participants only
DROP POLICY IF EXISTS "Messages viewable by authenticated" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
DROP POLICY IF EXISTS "Users can delete own messages" ON public.messages;

CREATE POLICY "Participants can view DMs"
  ON public.messages FOR SELECT TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

CREATE POLICY "Users can send DMs"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = sender_id AND sender_id <> recipient_id);

CREATE POLICY "Users can delete own DMs"
  ON public.messages FOR DELETE TO authenticated
  USING (auth.uid() = sender_id);

-- Tighten message_reads: only recipient of the message may mark it read,
-- and only participants of that message may view its reads
DROP POLICY IF EXISTS "Reads viewable by authenticated" ON public.message_reads;
DROP POLICY IF EXISTS "Users mark own reads" ON public.message_reads;
DROP POLICY IF EXISTS "Users delete own reads" ON public.message_reads;

CREATE POLICY "Participants view reads"
  ON public.message_reads FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_reads.message_id
        AND (auth.uid() = m.sender_id OR auth.uid() = m.recipient_id)
    )
  );

CREATE POLICY "Recipient marks read"
  ON public.message_reads FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_reads.message_id
        AND m.recipient_id = auth.uid()
    )
  );

CREATE POLICY "Users delete own reads"
  ON public.message_reads FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
