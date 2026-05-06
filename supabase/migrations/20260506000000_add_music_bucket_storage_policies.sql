-- Music bucket Storage RLS policies
-- Mirrors the pattern used for the backgrounds bucket but scoped to org folders.
-- Storage path convention is `${orgId}/${filename}`, so we extract the first
-- path segment with split_part(name, '/', 1) and check it against the user's
-- profile org_id.

-- Authenticated users can upload to their own org's folder in the music bucket
CREATE POLICY "Authenticated users can upload music to own org"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'music'
    AND split_part(name, '/', 1) = (
      SELECT org_id::text FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Authenticated users can update their own org's music files
CREATE POLICY "Authenticated users can update own org music"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'music'
    AND split_part(name, '/', 1) = (
      SELECT org_id::text FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Authenticated users can delete their own org's music files
CREATE POLICY "Authenticated users can delete own org music"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'music'
    AND split_part(name, '/', 1) = (
      SELECT org_id::text FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Public can read music files (bucket is already marked public for streaming;
-- this just makes the read path explicit and survives any future change to
-- the public flag).
CREATE POLICY "Public can read music"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'music');
