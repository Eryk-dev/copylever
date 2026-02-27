import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../lib/api';
import { Card } from './CopyPage';
import { useToast } from '../components/Toast';

interface UserRow {
  id: string;
  username: string;
  role: 'admin' | 'operator';
  can_run_compat: boolean;
  active: boolean;
  created_at: string;
  last_login_at: string | null;
}

interface Props {
  headers: () => Record<string, string>;
  currentUserId: string;
}

export default function UsersPage({ headers, currentUserId }: Props) {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Create form state
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'operator'>('operator');
  const [newCompat, setNewCompat] = useState(false);
  const [creating, setCreating] = useState(false);

  // Edit form state
  const [editPassword, setEditPassword] = useState('');
  const [editRole, setEditRole] = useState<'admin' | 'operator'>('operator');
  const [editCompat, setEditCompat] = useState(false);
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users`, { headers: headers() });
      if (res.ok) setUsers(await res.json());
    } catch (e) {
      console.error('Failed to load users:', e);
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const resetCreateForm = () => {
    setNewUsername('');
    setNewPassword('');
    setNewRole('operator');
    setNewCompat(false);
    setShowCreate(false);
  };

  const handleCreate = async () => {
    if (!newUsername.trim()) { toast('Informe o nome de usuário', 'error'); return; }
    if (newPassword.length < 4) { toast('Senha deve ter no mínimo 4 caracteres', 'error'); return; }
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
          can_run_compat: newCompat,
        }),
      });
      if (res.status === 409) { toast('Usuário já existe', 'error'); return; }
      if (!res.ok) { const err = await res.json().catch(() => ({ detail: 'Erro ao criar' })); toast(err.detail, 'error'); return; }
      toast('Usuário criado');
      resetCreateForm();
      fetchUsers();
    } catch { toast('Erro de conexão', 'error'); }
    finally { setCreating(false); }
  };

  const startEdit = (u: UserRow) => {
    setEditingId(u.id);
    setEditPassword('');
    setEditRole(u.role);
    setEditCompat(u.can_run_compat);
    setEditActive(u.active);
  };

  const handleUpdate = async (userId: string) => {
    const body: Record<string, unknown> = {
      role: editRole,
      can_run_compat: editCompat,
      active: editActive,
    };
    if (editPassword.length > 0) {
      if (editPassword.length < 4) { toast('Senha deve ter no mínimo 4 caracteres', 'error'); return; }
      body.password = editPassword;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({ detail: 'Erro ao atualizar' })); toast(err.detail, 'error'); return; }
      toast('Usuário atualizado');
      setEditingId(null);
      fetchUsers();
    } catch { toast('Erro de conexão', 'error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (userId: string, username: string) => {
    if (!confirm(`Tem certeza que deseja deletar "${username}"?`)) return;
    setDeletingId(userId);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: headers(),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({ detail: 'Erro ao deletar' })); toast(err.detail, 'error'); return; }
      toast('Usuário deletado');
      fetchUsers();
    } catch { toast('Erro de conexão', 'error'); }
    finally { setDeletingId(null); }
  };

  const formatDate = (d: string | null) => {
    if (!d) return 'Nunca';
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  };

  const inputStyle: React.CSSProperties = {
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 6,
    border: '1px solid var(--line)',
    background: 'var(--paper)',
    color: 'var(--ink)',
    fontSize: 'var(--text-sm)',
    width: '100%',
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: 'pointer',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 'var(--text-xs)',
    color: 'var(--ink-muted)',
    fontWeight: 500,
    marginBottom: 'var(--space-1)',
    display: 'block',
  };

  return (
    <Card title="Usuários">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-3)' }}>
        <button
          onClick={() => { setShowCreate(!showCreate); setEditingId(null); }}
          className="btn-primary"
          style={{ padding: '6px 14px', fontSize: 'var(--text-xs)' }}
        >
          {showCreate ? 'Cancelar' : 'Novo Usuário'}
        </button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <div className="animate-in" style={{
          background: 'var(--paper)',
          border: '1px solid var(--line)',
          borderRadius: 6,
          padding: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div>
              <label style={labelStyle}>Usuário</label>
              <input
                type="text"
                value={newUsername}
                onChange={e => setNewUsername(e.target.value)}
                placeholder="nome.operador"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Senha</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="mínimo 4 caracteres"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Role</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value as 'admin' | 'operator')} style={selectStyle}>
                <option value="operator">Operador</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 'var(--space-1)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                <input
                  type="checkbox"
                  checked={newCompat}
                  onChange={e => setNewCompat(e.target.checked)}
                />
                Pode rodar compat
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="btn-primary"
              style={{ padding: '6px 14px', fontSize: 'var(--text-xs)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
            >
              {creating && <span className="spinner spinner-sm" />}
              {creating ? 'Criando...' : 'Criar'}
            </button>
          </div>
        </div>
      )}

      {/* Users Table */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--ink-faint)', fontSize: 'var(--text-sm)', padding: 'var(--space-4)' }}>
          <span className="spinner spinner-sm" />
          Carregando...
        </div>
      ) : users.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: 'var(--space-8) var(--space-4)',
          color: 'var(--ink-faint)',
          fontSize: 'var(--text-sm)',
        }}>
          Nenhum usuário cadastrado.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {users.map(u => (
            <div key={u.id}>
              <div
                className="animate-in"
                style={{
                  background: 'var(--paper)',
                  borderRadius: 6,
                  padding: 'var(--space-3) var(--space-4)',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  opacity: u.active ? 1 : 0.5,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 'var(--text-sm)' }}>
                      {u.username}
                    </span>
                    <RoleBadge role={u.role} />
                    {u.can_run_compat && <Tag label="Compat" color="var(--positive)" />}
                    {!u.active && <Tag label="Inativo" color="var(--danger)" />}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-faint)', marginTop: 'var(--space-1)' }}>
                    Último login: {formatDate(u.last_login_at)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
                  <button
                    onClick={() => { startEdit(u); setShowCreate(false); }}
                    className="btn-ghost"
                    style={{ padding: '4px 10px', fontSize: 'var(--text-xs)' }}
                  >
                    Editar
                  </button>
                  {u.id !== currentUserId && (
                    <button
                      onClick={() => handleDelete(u.id, u.username)}
                      disabled={deletingId === u.id}
                      className="btn-danger-ghost"
                      style={{
                        padding: '4px 10px',
                        fontSize: 'var(--text-xs)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-1)',
                        opacity: deletingId === u.id ? 0.5 : 1,
                      }}
                    >
                      {deletingId === u.id && <span className="spinner spinner-sm" style={{ borderTopColor: 'var(--danger)' }} />}
                      {deletingId === u.id ? 'Deletando...' : 'Deletar'}
                    </button>
                  )}
                </div>
              </div>

              {/* Edit Form (inline below row) */}
              {editingId === u.id && (
                <div className="animate-in" style={{
                  background: 'var(--paper)',
                  border: '1px solid var(--line)',
                  borderTop: 'none',
                  borderRadius: '0 0 6px 6px',
                  padding: 'var(--space-4)',
                  marginTop: -1,
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                    <div>
                      <label style={labelStyle}>Nova Senha (deixe vazio para manter)</label>
                      <input
                        type="password"
                        value={editPassword}
                        onChange={e => setEditPassword(e.target.value)}
                        placeholder="nova senha"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Role</label>
                      <select value={editRole} onChange={e => setEditRole(e.target.value as 'admin' | 'operator')} style={selectStyle}>
                        <option value="operator">Operador</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                        <input
                          type="checkbox"
                          checked={editCompat}
                          onChange={e => setEditCompat(e.target.checked)}
                        />
                        Pode rodar compat
                      </label>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--ink)' }}>
                        <input
                          type="checkbox"
                          checked={editActive}
                          onChange={e => setEditActive(e.target.checked)}
                        />
                        Ativo
                      </label>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                    <button
                      onClick={() => setEditingId(null)}
                      className="btn-ghost"
                      style={{ padding: '6px 14px', fontSize: 'var(--text-xs)' }}
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => handleUpdate(u.id)}
                      disabled={saving}
                      className="btn-primary"
                      style={{ padding: '6px 14px', fontSize: 'var(--text-xs)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                    >
                      {saving && <span className="spinner spinner-sm" />}
                      {saving ? 'Salvando...' : 'Salvar'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function RoleBadge({ role }: { role: string }) {
  const isAdmin = role === 'admin';
  return (
    <span style={{
      fontSize: 'var(--text-xs)',
      fontWeight: 600,
      textTransform: 'uppercase',
      padding: '1px 6px',
      borderRadius: 4,
      background: isAdmin ? 'rgba(99, 102, 241, 0.1)' : 'rgba(107, 114, 128, 0.1)',
      color: isAdmin ? '#6366f1' : 'var(--ink-muted)',
    }}>
      {isAdmin ? 'Admin' : 'Operador'}
    </span>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 'var(--text-xs)',
      fontWeight: 500,
      padding: '1px 6px',
      borderRadius: 4,
      color,
      background: `color-mix(in srgb, ${color} 10%, transparent)`,
    }}>
      {label}
    </span>
  );
}
