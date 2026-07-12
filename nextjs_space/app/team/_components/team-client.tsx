'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users, Mail, Shield, UserPlus, Trash2, Save, Loader2,
  Crown, Eye, UserCog, Plus, X, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface Member {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  image: string | null;
  createdAt: string;
}

interface ApprovedEmailEntry {
  id: string;
  email: string;
  label: string | null;
  addedBy: string | null;
  createdAt: string;
}

interface TeamData {
  team: { id: string | null; name: string; slug: string; description: string | null };
  members: Member[];
  approvedEmails: ApprovedEmailEntry[];
  currentUser: { id: string; email: string; role: string };
}

const ROLE_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
  admin: { label: 'Admin', icon: Crown, color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  user: { label: 'Member', icon: UserCog, color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  viewer: { label: 'Viewer', icon: Eye, color: 'bg-slate-500/20 text-slate-300 border-slate-500/30' },
};

export function TeamClient() {
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [teamName, setTeamName] = useState('');
  const [teamDesc, setTeamDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newEmailLabel, setNewEmailLabel] = useState('');
  const [addingEmail, setAddingEmail] = useState(false);
  const [showAddEmail, setShowAddEmail] = useState(false);
  const [error, setError] = useState('');

  const isAdmin = data?.currentUser?.role === 'admin';

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/team');
      const json = await res.json();
      setData(json);
      setTeamName(json.team?.name || '');
      setTeamDesc(json.team?.description || '');
    } catch (e) {
      console.error('Failed to fetch team data', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSaveTeam = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch('/api/team', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: teamName, description: teamDesc }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      fetchData();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const res = await fetch('/api/team/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: newRole }),
      });
      if (!res.ok) {
        const e = await res.json();
        setError(e.error);
        setTimeout(() => setError(''), 3000);
        return;
      }
      fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddEmail = async () => {
    if (!newEmail) return;
    setAddingEmail(true);
    setError('');
    try {
      const res = await fetch('/api/team/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, label: newEmailLabel }),
      });
      if (!res.ok) {
        const e = await res.json();
        setError(e.error);
        setTimeout(() => setError(''), 3000);
        return;
      }
      setNewEmail('');
      setNewEmailLabel('');
      setShowAddEmail(false);
      fetchData();
    } catch (e) {
      console.error(e);
    } finally {
      setAddingEmail(false);
    }
  };

  const handleRemoveEmail = async (emailId: string) => {
    try {
      await fetch('/api/team/emails', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailId }),
      });
      fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-display font-bold text-white tracking-tight flex items-center gap-3">
          <Users className="h-8 w-8 text-blue-400" />
          Team Management
        </h1>
        <p className="text-slate-400 mt-1">Manage your team, dashboard access, and approved sender emails.</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Team Info */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-400" />
            Team Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">Team Name</label>
              <Input
                value={teamName}
                onChange={(e: any) => setTeamName(e.target.value)}
                disabled={!isAdmin}
                className="bg-white/5 border-white/10 text-white"
                placeholder="e.g. Russak Family"
              />
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-1.5 block">Description</label>
              <Input
                value={teamDesc}
                onChange={(e: any) => setTeamDesc(e.target.value)}
                disabled={!isAdmin}
                className="bg-white/5 border-white/10 text-white"
                placeholder="e.g. Family form processing team"
              />
            </div>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Button
                onClick={handleSaveTeam}
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 text-white"
                size="sm"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : saved ? <CheckCircle2 className="h-4 w-4 mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                {saved ? 'Saved' : 'Save'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dashboard Members */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-teal-400" />
            Dashboard Members
            <Badge variant="outline" className="ml-auto border-white/10 text-slate-400">
              {data?.members?.length ?? 0} members
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500 mb-4">Users who can log in to this dashboard. Roles: Admin (full access), Member (view + edit), Viewer (read only).</p>
          <div className="space-y-3">
            {data?.members?.map((member) => {
              const roleInfo = ROLE_CONFIG[member.role] || ROLE_CONFIG.user;
              const RoleIcon = roleInfo.icon;
              const isCurrentUser = member.id === data.currentUser.id;
              return (
                <div key={member.id} className="flex items-center gap-4 p-3 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] transition-colors">
                  <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center text-blue-300 text-sm font-bold flex-shrink-0">
                    {member.name?.[0] ?? member.email?.[0] ?? '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white truncate">
                      {member.name || 'No name'}
                      {isCurrentUser && <span className="text-slate-500 ml-1">(you)</span>}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isAdmin && !isCurrentUser ? (
                      <select
                        value={member.role}
                        onChange={(e) => handleRoleChange(member.id, e.target.value)}
                        className="text-xs bg-white/5 border border-white/10 rounded-md px-2 py-1 text-slate-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="admin">Admin</option>
                        <option value="user">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    ) : (
                      <Badge variant="outline" className={roleInfo.color}>
                        <RoleIcon className="h-3 w-3 mr-1" />
                        {roleInfo.label}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Approved Sender Emails */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Mail className="h-5 w-5 text-emerald-400" />
            Approved Sender Emails
            <Badge variant="outline" className="ml-auto border-white/10 text-slate-400">
              {data?.approvedEmails?.length ?? 0} emails
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500 mb-4">Only emails from these addresses will be processed by Form Claw. Others are silently dropped.</p>
          <div className="space-y-2">
            {data?.approvedEmails?.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/5">
                <Mail className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-mono truncate">{entry.email}</p>
                  {entry.label && <p className="text-xs text-slate-500">{entry.label}</p>}
                </div>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveEmail(entry.id)}
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}

            {data?.approvedEmails?.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-4">No approved emails configured yet.</p>
            )}
          </div>

          {isAdmin && (
            <div className="mt-4">
              {showAddEmail ? (
                <div className="flex items-end gap-2 p-3 rounded-lg bg-white/[0.03] border border-white/5">
                  <div className="flex-1 space-y-2">
                    <Input
                      value={newEmail}
                      onChange={(e: any) => setNewEmail(e.target.value)}
                      placeholder="email@example.com"
                      className="bg-white/5 border-white/10 text-white text-sm"
                    />
                    <Input
                      value={newEmailLabel}
                      onChange={(e: any) => setNewEmailLabel(e.target.value)}
                      placeholder="Label (optional, e.g. 'Mom')"
                      className="bg-white/5 border-white/10 text-white text-sm"
                    />
                  </div>
                  <Button
                    onClick={handleAddEmail}
                    disabled={addingEmail || !newEmail}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    size="sm"
                  >
                    {addingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setShowAddEmail(false); setNewEmail(''); setNewEmailLabel(''); }}
                    className="text-slate-400"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddEmail(true)}
                  className="border-white/10 text-slate-300 hover:text-white"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Email
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
