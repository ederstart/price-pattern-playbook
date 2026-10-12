CREATE TABLE public.candles (
  tf text NOT NULL,
  t bigint NOT NULL,
  o double precision NOT NULL,
  h double precision NOT NULL,
  l double precision NOT NULL,
  c double precision NOT NULL,
  PRIMARY KEY (tf, t)
);
GRANT SELECT ON public.candles TO anon, authenticated;
GRANT ALL ON public.candles TO service_role;
ALTER TABLE public.candles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read candles" ON public.candles FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.operations (
  key text PRIMARY KEY,
  tf text NOT NULL,
  type text NOT NULL,
  dir smallint NOT NULL,
  status text NOT NULL,
  strength text NOT NULL,
  fvg_time bigint NOT NULL,
  closed_time bigint,
  entry double precision NOT NULL,
  stop double precision NOT NULL,
  take double precision NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operations_tf_time ON public.operations (tf, fvg_time DESC);
GRANT SELECT ON public.operations TO anon, authenticated;
GRANT ALL ON public.operations TO service_role;
ALTER TABLE public.operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read operations" ON public.operations FOR SELECT TO anon, authenticated USING (true);