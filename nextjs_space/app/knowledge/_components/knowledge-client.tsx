'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Brain, Plus, Search, Filter, Edit2, Trash2, Save, X, Loader2, User, Users, Globe, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface KnowledgeEntry {
  id: string;
  category: string;
  key: string;
  value: string;
  source: string;
  language: string;
  appliesToPerson: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES = [
  { value: 'all', label: 'All Categories' },
  { value: 'personal', label: 'Personal Info' },
  { value: 'address', label: 'Address' },
  { value: 'medical', label: 'Medical' },
  { value: 'school', label: 'School' },
  { value: 'contact', label: 'Contact' },
  { value: 'preference', label: 'Preference' },
  { value: 'general', label: 'General' },
];

const DEFAULT_PERSONS = [
  { value: 'all', label: 'All People' },
  { value: 'family', label: 'Family-wide' },
];

const LANGUAGES = [
  { value: 'both', label: 'Both' },
  { value: 'he', label: 'עברית' },
  { value: 'en', label: 'English' },
];

const CATEGORY_COLORS: Record<string, string> = {
  personal: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  address: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
  medical: 'bg-red-500/10 text-red-300 border-red-500/20',
  school: 'bg-green-500/10 text-green-300 border-green-500/20',
  contact: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
  preference: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
  general: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
};

function getPersonIcon(person: string | null) {
  if (!person) return <Users className="h-3.5 w-3.5" />;
  return <User className="h-3.5 w-3.5" />;
}

export function KnowledgeClient() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [personFilter, setPersonFilter] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<KnowledgeEntry>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ key: '', value: '', category: 'general', language: 'both', appliesToPerson: '', source: 'manual' });
  const [saving, setSaving] = useState(false);
  const [persons, setPersons] = useState(DEFAULT_PERSONS);

  // Load unique person names from entries
  useEffect(() => {
    fetch('/api/knowledge?limit=500')
      .then(r => r.json())
      .then(data => {
        const names = new Set<string>();
        (data.entries || []).forEach((e: KnowledgeEntry) => {
          if (e.appliesToPerson) names.add(e.appliesToPerson);
        });
        const dynamicPersons = Array.from(names).sort().map(n => ({ value: n, label: n }));
        setPersons([...DEFAULT_PERSONS, ...dynamicPersons]);
      })
      .catch(() => {});
  }, []);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '30' });
      if (catFilter !== 'all') params.set('category', catFilter);
      if (personFilter !== 'all') params.set('person', personFilter);
      if (search) params.set('search', search);
      const res = await fetch(`/api/knowledge?${params}`);
      if (!res.ok) throw new Error('Fetch failed');
      const data = await res.json();
      setEntries(data.entries);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (err) {
      console.error('Failed to fetch knowledge:', err);
    } finally {
      setLoading(false);
    }
  }, [page, catFilter, personFilter, search]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
  };

  const startEdit = (entry: KnowledgeEntry) => {
    setEditingId(entry.id);
    setEditForm({ ...entry });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/knowledge/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) throw new Error('Update failed');
      cancelEdit();
      fetchEntries();
    } catch (err) {
      console.error('Failed to update:', err);
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (id: string) => {
    if (!confirm('Remove this knowledge entry?')) return;
    try {
      await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
      fetchEntries();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const addEntry = async () => {
    if (!addForm.key || !addForm.value) return;
    setSaving(true);
    try {
      const res = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...addForm,
          appliesToPerson: addForm.appliesToPerson || null,
        }),
      });
      if (!res.ok) throw new Error('Create failed');
      setAddForm({ key: '', value: '', category: 'general', language: 'both', appliesToPerson: '', source: 'manual' });
      setShowAdd(false);
      fetchEntries();
    } catch (err) {
      console.error('Failed to add:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-white flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <Brain className="h-6 w-6 text-amber-400" />
            </div>
            Knowledge Base
          </h1>
          <p className="text-sm text-white/50 mt-2 ml-14">
            {total} entries — the bot uses this data to fill forms. Auto-curated from interactions.
          </p>
        </div>
        <Button onClick={() => setShowAdd(!showAdd)} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-2" /> Add Entry
        </Button>
      </div>

      {/* Add Entry Form */}
      {showAdd && (
        <Card className="bg-white/[0.03] border-blue-500/20 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-blue-300">New Knowledge Entry</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-white/50 mb-1 block">Key / Label *</label>
              <Input value={addForm.key} onChange={(e) => setAddForm({ ...addForm, key: e.target.value })} className="bg-white/5 border-white/10 text-white" placeholder="e.g. Full Name" />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Value *</label>
              <Input value={addForm.value} onChange={(e) => setAddForm({ ...addForm, value: e.target.value })} className="bg-white/5 border-white/10 text-white" placeholder="e.g. John Smith" />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Category</label>
              <select value={addForm.category} onChange={(e) => setAddForm({ ...addForm, category: e.target.value })} className="w-full rounded-md bg-white/5 border border-white/10 text-white text-sm py-2 px-3">
                {CATEGORIES.filter(c => c.value !== 'all').map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Applies To</label>
              <select value={addForm.appliesToPerson} onChange={(e) => setAddForm({ ...addForm, appliesToPerson: e.target.value })} className="w-full rounded-md bg-white/5 border border-white/10 text-white text-sm py-2 px-3">
                <option value="">Family-wide</option>
                {persons.filter(p => p.value !== 'all' && p.value !== 'family').map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Language</label>
              <select value={addForm.language} onChange={(e) => setAddForm({ ...addForm, language: e.target.value })} className="w-full rounded-md bg-white/5 border border-white/10 text-white text-sm py-2 px-3">
                {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Source</label>
              <Input value={addForm.source} onChange={(e) => setAddForm({ ...addForm, source: e.target.value })} className="bg-white/5 border-white/10 text-white" placeholder="manual" />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={addEntry} disabled={saving || !addForm.key || !addForm.value} className="bg-green-600 hover:bg-green-700 text-white">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save
            </Button>
            <Button onClick={() => setShowAdd(false)} variant="outline" className="border-white/10 text-white/60">
              <X className="h-4 w-4 mr-2" /> Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
          <Input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/30"
            placeholder="Search knowledge..."
          />
        </div>
        <select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPage(1); }} className="rounded-md bg-white/5 border border-white/10 text-white text-sm py-2 px-3">
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select value={personFilter} onChange={(e) => { setPersonFilter(e.target.value); setPage(1); }} className="rounded-md bg-white/5 border border-white/10 text-white text-sm py-2 px-3">
          {persons.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>

      {/* Entries List */}
      {loading ? (
        <div className="flex items-center justify-center h-48"><Loader2 className="h-8 w-8 animate-spin text-blue-400" /></div>
      ) : entries.length === 0 ? (
        <Card className="bg-white/[0.02] border-white/5 p-12 text-center">
          <Brain className="h-12 w-12 text-white/10 mx-auto mb-4" />
          <p className="text-white/40">No knowledge entries found.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <Card key={entry.id} className="bg-white/[0.03] border-white/10 p-4 hover:bg-white/[0.05] transition-colors">
              {editingId === entry.id ? (
                /* Edit Mode */
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-white/40 mb-1 block">Key</label>
                      <Input value={editForm.key || ''} onChange={(e) => setEditForm({ ...editForm, key: e.target.value })} className="bg-white/5 border-white/10 text-white text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-white/40 mb-1 block">Value</label>
                      <Input value={editForm.value || ''} onChange={(e) => setEditForm({ ...editForm, value: e.target.value })} className="bg-white/5 border-white/10 text-white text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-white/40 mb-1 block">Category</label>
                      <select value={editForm.category || 'general'} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="w-full rounded-md bg-white/5 border border-white/10 text-white text-sm py-2 px-3">
                        {CATEGORIES.filter(c => c.value !== 'all').map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-white/40 mb-1 block">Applies To</label>
                      <select value={editForm.appliesToPerson || ''} onChange={(e) => setEditForm({ ...editForm, appliesToPerson: e.target.value || null })} className="w-full rounded-md bg-white/5 border border-white/10 text-white text-sm py-2 px-3">
                        <option value="">Family-wide</option>
                        {persons.filter(p => p.value !== 'all' && p.value !== 'family').map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={saveEdit} disabled={saving} size="sm" className="bg-green-600 hover:bg-green-700 text-white">
                      {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />} Save
                    </Button>
                    <Button onClick={cancelEdit} size="sm" variant="outline" className="border-white/10 text-white/60"><X className="h-3 w-3 mr-1" /> Cancel</Button>
                  </div>
                </div>
              ) : (
                /* View Mode */
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <Badge className={`text-[10px] border ${CATEGORY_COLORS[entry.category] || CATEGORY_COLORS.general}`}>
                        {entry.category}
                      </Badge>
                      <span className="text-xs text-white/30 flex items-center gap-1">
                        {getPersonIcon(entry.appliesToPerson)}
                        {entry.appliesToPerson || 'Family'}
                      </span>
                      {entry.language !== 'both' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30">
                          {entry.language === 'he' ? 'עב' : 'EN'}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-white/70 font-medium">{entry.key}</p>
                    <p className="text-sm text-white mt-0.5" dir={entry.language === 'he' ? 'rtl' : 'ltr'}>{entry.value}</p>
                    <p className="text-[10px] text-white/20 mt-1">
                      Source: {entry.source} · Updated {new Date(entry.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => startEdit(entry)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-blue-400 transition-colors">
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => deleteEntry(entry.id)} className="p-1.5 rounded-lg hover:bg-white/10 text-white/30 hover:text-red-400 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <p className="text-xs text-white/30">Page {page} of {totalPages} ({total} entries)</p>
          <div className="flex gap-2">
            <Button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} size="sm" variant="outline" className="border-white/10 text-white/60">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} size="sm" variant="outline" className="border-white/10 text-white/60">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
