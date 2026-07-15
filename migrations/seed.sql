-- Seed data: default templates for quick start

-- Insert default templates (no company specific)
INSERT INTO templates (id, name, description, layout_config, is_default) VALUES
('tpl-classic', 'Classic',
 'Clean, traditional layout with company letterhead',
 '{"fontSize":12,"showLogo":true,"showAddress":true,"showBank":true,"showSignature":true,"border":"single","accentColor":"zinc"}',
 1),
('tpl-modern', 'Modern',
 'Sleek minimal design with colored header bar',
 '{"fontSize":11,"showLogo":true,"showAddress":true,"showBank":true,"showSignature":true,"border":"minimal","accentColor":"blue"}',
 0),
('tpl-compact', 'Compact',
 'Space-efficient layout for printing multiple vouchers per page',
 '{"fontSize":10,"showLogo":false,"showAddress":false,"showBank":false,"showSignature":true,"border":"none","accentColor":"zinc"}',
 0);
