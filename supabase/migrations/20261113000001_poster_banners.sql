-- Poster banners: a ready-made banner picture that already contains its own words (e.g. an "11:11 Special Offer" design).
-- The website shows the WHOLE picture at its own shape (never cropped, never stretched), full width, in a slider under the
-- globe; the title is kept as the picture's description for screen readers. Ordinary banners ('card') are unchanged.
SET search_path = app, extensions;

ALTER TABLE app.banners ADD COLUMN style text NOT NULL DEFAULT 'card' CHECK (style IN ('card', 'poster'));
-- a poster is nothing without its picture
ALTER TABLE app.banners ADD CONSTRAINT banners_poster_has_image CHECK (style <> 'poster' OR coalesce(image_url, '') <> '');

CREATE OR REPLACE FUNCTION app.legacy_banners(p_include_inactive boolean DEFAULT false) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', h.public_id, 'eyebrow', h.eyebrow, 'title', h.title, 'subtitle', h.subtitle, 'cta', h.cta,
           'link', h.link, 'color', h.color, 'shape', h.shape, 'image', coalesce(h.image_url, ''), 'style', h.style) ORDER BY h.sort_order, h.public_id), '[]'::jsonb)
    FROM app.banners h WHERE p_include_inactive OR h.active
$$;

CREATE OR REPLACE FUNCTION public.admin_save_banners(p_list jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE l jsonb; h jsonb; i int := 0; v_before jsonb := app.legacy_banners(true);
BEGIN
  PERFORM app.require_perm('content.write');
  l := app.v_object_list(jsonb_build_object('banners', p_list), 'banners', 20,
    '{"id":{"max":40,"re":"^[A-Za-z0-9_-]+$"},"eyebrow":{"max":40},"title":{"max":60},"subtitle":{"max":120},"cta":{"max":30},"link":{"max":300,"link":true},"color":{"max":20,"color":true},"shape":{"max":30,"re":"^[a-z0-9-]+$"},"image":{"max":2000,"re":"^((https?://|/).*)?$"},"style":{"max":10,"re":"^(card|poster)$"}}');
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(l) x WHERE NOT x ? 'id') THEN PERFORM app.fail('bad_request', 'every banner needs an id'); END IF;
  IF (SELECT count(DISTINCT x ->> 'id') FROM jsonb_array_elements(l) x) <> jsonb_array_length(l) THEN PERFORM app.fail('bad_request', 'Two banners have the same id.'); END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(l) x WHERE x ->> 'style' = 'poster' AND coalesce(x ->> 'image', '') = '') THEN
    PERFORM app.fail('bad_request', 'A poster banner needs its picture.');
  END IF;
  DELETE FROM app.banners WHERE NOT (public_id = ANY (ARRAY(SELECT x ->> 'id' FROM jsonb_array_elements(l) x)));
  FOR h IN SELECT * FROM jsonb_array_elements(l) LOOP
    INSERT INTO app.banners (public_id, sort_order, eyebrow, title, subtitle, cta, link, color, shape, image_url, style)
    VALUES (h ->> 'id', i, coalesce(h ->> 'eyebrow', ''), coalesce(h ->> 'title', ''), coalesce(h ->> 'subtitle', ''), coalesce(h ->> 'cta', ''), coalesce(h ->> 'link', '#'),
            coalesce(h ->> 'color', '#0b2a6f'), coalesce(h ->> 'shape', 'tshirt'), nullif(h ->> 'image', ''), coalesce(h ->> 'style', 'card'))
    ON CONFLICT (public_id) DO UPDATE SET sort_order = EXCLUDED.sort_order, eyebrow = EXCLUDED.eyebrow, title = EXCLUDED.title, subtitle = EXCLUDED.subtitle, cta = EXCLUDED.cta,
       link = EXCLUDED.link, color = EXCLUDED.color, shape = EXCLUDED.shape, image_url = EXCLUDED.image_url, style = EXCLUDED.style, updated_at = now();
    i := i + 1;
  END LOOP;
  PERFORM app.audit('banners.update', 'banners', NULL, v_before, l);
  PERFORM app.enqueue_job('catalog.snapshot', '{}'::jsonb, 'catalog.snapshot:' || to_char(now(), 'YYYYMMDDHH24MI'));
  RETURN app.legacy_banners(true);
END $$;
