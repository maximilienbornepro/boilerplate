import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { Layout, ModuleHeader, ConfirmModal } from '@boilerplate/shared/components';
import { RagList } from './components/RagList/RagList.js';
import { RagForm } from './components/RagForm/RagForm.js';
import { RagDetail } from './components/RagDetail/RagDetail.js';
import { EmbedChat } from './components/EmbedChat/EmbedChat.js';
import type { RagBot } from './types/index.js';
import { fetchBots, createBot, updateBot, deleteBot } from './services/api.js';
import './App.css';

interface AppProps {
  onNavigate?: (path: string) => void;
  embedMode?: boolean;
  embedId?: string;
}

export default function App({ onNavigate, embedMode, embedId }: AppProps) {
  if (embedMode && embedId) {
    return <EmbedChat uuid={embedId} />;
  }
  return (
    <Routes>
      <Route path="/:botId" element={<RagDetailPage onNavigate={onNavigate} />} />
      <Route path="/" element={<RagListPage onNavigate={onNavigate} />} />
    </Routes>
  );
}

function RagDetailPage({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { botId } = useParams<{ botId: string }>();
  const navigate = useNavigate();
  const [bot, setBot] = useState<RagBot | null>(null);

  useEffect(() => {
    if (!botId) return;
    fetchBots().then(list => {
      const found = list.find(b => String(b.id) === botId);
      if (found) setBot(found);
      else navigate('/rag');
    }).catch(() => navigate('/rag'));
  }, [botId]);

  const handleCopyEmbed = useCallback((b: RagBot) => {
    const url = `${window.location.origin}/rag?embed=${b.uuid}`;
    navigator.clipboard.writeText(url).catch(console.error);
  }, []);

  if (!bot) return null;

  return (
    <RagDetail
      bot={bot}
      onBack={() => navigate('/rag')}
      onCopyEmbed={handleCopyEmbed}
      onNavigate={onNavigate}
    />
  );
}

function RagListPage({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const navigate = useNavigate();
  const [bots, setBots] = useState<RagBot[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editBot, setEditBot] = useState<RagBot | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<RagBot | null>(null);

  useEffect(() => {
    fetchBots().then(list => {
      setBots(list);
      if (list.length === 0) { setEditBot(undefined); setShowForm(true); }
    }).catch(console.error);
  }, []);

  const handleCreate = useCallback(async (name: string, description: string) => {
    const bot = await createBot({ name, description: description || undefined });
    setBots((prev) => [bot, ...prev]);
    navigate(`/rag/${bot.id}`);
  }, []);

  const handleUpdate = useCallback(async (name: string, description: string) => {
    if (!editBot) return;
    const updated = await updateBot(editBot.id, { name, description: description || undefined });
    setBots((prev) => prev.map((b) => b.id === updated.id ? updated : b));
    setEditBot(undefined);
  }, [editBot]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return;
    await deleteBot(confirmDelete.id);
    setBots((prev) => prev.filter((b) => b.id !== confirmDelete.id));
    setConfirmDelete(null);
  }, [confirmDelete]);

  return (
    <Layout appId="rag" variant="full-width" onNavigate={onNavigate}>
      <ModuleHeader
        title="RAG"
        subtitle={`${bots.length} assistant${bots.length !== 1 ? 's' : ''}`}
      >
        <button
          className="module-header-btn module-header-btn-primary"
          onClick={() => { setEditBot(undefined); setShowForm(true); }}
        >
          + Nouveau RAG
        </button>
      </ModuleHeader>

      <RagList
        bots={bots}
        onOpen={(bot) => navigate(`/rag/${bot.id}`)}
        onEdit={(bot) => { setEditBot(bot); setShowForm(true); }}
        onDelete={(bot) => setConfirmDelete(bot)}
        onCreate={() => { setEditBot(undefined); setShowForm(true); }}
      />

      {showForm && (
        <RagForm
          bot={editBot}
          onSubmit={editBot ? handleUpdate : handleCreate}
          onClose={() => { setShowForm(false); setEditBot(undefined); }}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Supprimer ce RAG ?"
          message={`Le RAG "${confirmDelete.name}" et toutes ses données (documents, chunks, conversations) seront définitivement supprimés.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
          confirmLabel="Supprimer"
          danger
        />
      )}
    </Layout>
  );
}
