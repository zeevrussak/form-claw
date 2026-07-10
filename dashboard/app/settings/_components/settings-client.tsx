'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings, Save, Type, RotateCcw, CheckCircle2, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ConfigEntry {
  id: string;
  key: string;
  value: string;
  label: string | null;
  category: string;
}

const DEFAULT_FONTS = {
  font_english: 'Playzone',
  font_hebrew: 'פיל כחול',
};

export function SettingsClient() {
  const [configs, setConfigs] = useState<ConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [englishFont, setEnglishFont] = useState(DEFAULT_FONTS.font_english);
  const [hebrewFont, setHebrewFont] = useState(DEFAULT_FONTS.font_hebrew);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/config?category=fonts');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setConfigs(data.configs);

      const eng = data.configs.find((c: ConfigEntry) => c.key === 'font_english');
      const heb = data.configs.find((c: ConfigEntry) => c.key === 'font_hebrew');
      if (eng) setEnglishFont(eng.value);
      if (heb) setHebrewFont(heb.value);
    } catch (err) {
      console.error('Failed to load config:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configs: [
            { key: 'font_english', value: englishFont, label: 'English Font', category: 'fonts' },
            { key: 'font_hebrew', value: hebrewFont, label: 'Hebrew Font', category: 'fonts' },
          ],
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      fetchConfig();
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setEnglishFont(DEFAULT_FONTS.font_english);
    setHebrewFont(DEFAULT_FONTS.font_hebrew);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-display font-bold text-white flex items-center gap-3">
          <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20">
            <Settings className="h-6 w-6 text-purple-400" />
          </div>
          Settings
        </h1>
        <p className="text-sm text-white/50 mt-2 ml-14">
          Configure fonts and other options used by the form-filling bot.
        </p>
      </div>

      {/* Font Configuration */}
      <Card className="bg-white/[0.03] border-white/10 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-blue-500/10">
            <Type className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Font Configuration</h2>
            <p className="text-xs text-white/40">Fonts used when filling PDF forms. Must match installed font file names.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* English Font */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-white/70 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 text-xs font-mono">EN</span>
              English Font
            </label>
            <Input
              value={englishFont}
              onChange={(e) => setEnglishFont(e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
              placeholder="e.g. Playzone"
            />
            <div className="rounded-lg bg-white/[0.02] border border-white/5 p-4">
              <p className="text-xs text-white/30 mb-2">Preview (system fallback):</p>
              <p className="text-lg text-white/80" style={{ fontFamily: `"${englishFont}", sans-serif` }}>
                John Smith — 123 Main Street, Anytown
              </p>
            </div>
            <p className="text-xs text-white/30">
              Font file: <code className="px-1.5 py-0.5 rounded bg-white/5 text-blue-300/60">Playzone.ttf</code> in <code className="px-1.5 py-0.5 rounded bg-white/5 text-blue-300/60">/shared/fonts/</code>
            </p>
          </div>

          {/* Hebrew Font */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-white/70 flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 text-xs font-mono">HE</span>
              Hebrew Font
            </label>
            <Input
              value={hebrewFont}
              onChange={(e) => setHebrewFont(e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
              placeholder="e.g. פיל כחול"
              dir="rtl"
            />
            <div className="rounded-lg bg-white/[0.02] border border-white/5 p-4">
              <p className="text-xs text-white/30 mb-2">Preview (system fallback):</p>
              <p className="text-lg text-white/80" dir="rtl" style={{ fontFamily: `"FtPilKahol2", "${hebrewFont}", sans-serif` }}>
                יוחנן כהן — רחוב הראשי 1, תל אביב
              </p>
            </div>
            <p className="text-xs text-white/30">
              Font file: <code className="px-1.5 py-0.5 rounded bg-white/5 text-emerald-300/60">FtPilKahol2.ttf</code> in <code className="px-1.5 py-0.5 rounded bg-white/5 text-emerald-300/60">/shared/fonts/</code>
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 mt-8 pt-6 border-t border-white/5">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : saved ? (
              <CheckCircle2 className="h-4 w-4 mr-2 text-green-300" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {saved ? 'Saved!' : 'Save Configuration'}
          </Button>
          <Button
            onClick={handleReset}
            variant="outline"
            className="border-white/10 text-white/60 hover:text-white hover:bg-white/5"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset to Defaults
          </Button>
        </div>
      </Card>

      {/* Info Card */}
      <Card className="bg-white/[0.02] border-white/5 p-5">
        <h3 className="text-sm font-medium text-white/60 mb-2">How Font Configuration Works</h3>
        <ul className="text-xs text-white/40 space-y-1.5 list-disc list-inside">
          <li>The form-filling bot reads these font names when filling PDF fields.</li>
          <li>Font files (.ttf) must be present in <code className="px-1 py-0.5 rounded bg-white/5">/shared/fonts/</code> on the processing server.</li>
          <li>The English font is used for Latin text fields, the Hebrew font for Hebrew text fields.</li>
          <li>Changing fonts here takes effect on the next form processed.</li>
        </ul>
      </Card>
    </div>
  );
}
