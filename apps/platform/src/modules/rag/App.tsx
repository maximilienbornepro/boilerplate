import { useState, useEffect, useCallback } from 'react';
import { Layout, ModuleHeader, ConfirmModal } from '@boilerplate/shared/components';
import { RagList } from './components/RagList/RagList.js';
import { RagForm } from './components/RagForm/RagForm.js';
import { RagDetail } from './components/RagDetail/RagDetail.js';
import { EmbedChat } from './components/EmbedChat/EmbedChat.js';
import type { RagBot } from './types/index.js';
import { fetchBots, createBot, updateBot, deleteBot } from './services/api.js';
import './App.css';

type View =
  | { type: 'list' }
  | { type: 'detail'; bot: RagBot };

interface AppProps {
  onNavigate?: (path: string) => void;
  embedMode?: boolean;
  embedId?: string;
}

export default function App({ onNavigate, embedMode, embedId }: AppProps) {
  // Embed mode: render public chat directly, no auth
  if (embedMode && embedId) {
    return <EmbedChat uuid={embedId} />;
  }
  return <RagApp onNavigate={onNavigate} />;
}

function RagApp({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const [view, setView] = useState<View>({ type: 'list' });
  const [bots, setBots] = useState<RagBot[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editBot, setEditBot] = useState<RagBot | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<RagBot | null>(null);

  useEffect(() => {
    if (view.type === 'list') {
      fetchBots().then(list => {
        setBots(list);
        if (list.length === 0) { setEditBot(undefined); setShowForm(true); }
      }).catch(console.error);
    }
  }, [view]);

  const handleCreate = useCallback(async (name: string, description: string) => {
    const bot = await createBot({ name, description: description || undefined });
    setBots((prev) => [bot, ...prev]);
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

  const handleCopyEmbed = useCallback((bot: RagBot) => {
    const url = `${window.location.origin}/rag?embed=${bot.uuid}`;
    navigator.clipboard.writeText(url).catch(console.error);
  }, []);

  // Detail view — full-screen
  if (view.type === 'detail') {
    return (
      <RagDetail
        bot={view.bot}
        onBack={() => setView({ type: 'list' })}
        onCopyEmbed={handleCopyEmbed}
        onNavigate={onNavigate}
      />
    );
  }

  // List view
  return (
    <Layout appId="rag" variant="full-width" onNavigate={onNavigate}>
      <ModuleHeader
        title="RAG"
        subtitle={`${bots.length} assistant${bots.length !== 1 ? 's' : ''}`}
        onBack={() => onNavigate ? onNavigate('/') : (window.location.href = '/')}
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
        onOpen={(bot) => setView({ type: 'detail', bot })}
        onEdit={(bot) => { setEditBot(bot); setShowForm(true); }}
        onDelete={(bot) => setConfirmDelete(bot)}
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
        />
      )}
    </Layout>
  );
}
