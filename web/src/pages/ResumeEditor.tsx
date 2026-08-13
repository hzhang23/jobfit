import { useEffect, useState } from 'react';
import { api } from '../api';

export function ResumeEditor() {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    // GET /me returns a summary only, so seed the editor from an empty string
    // and let the user paste. Saving always creates a new version.
    api.me().then((m) => setStatus(m.resume ? `Version ${m.resume.version}, ${m.resume.charCount} characters` : 'No resume saved yet'));
  }, []);

  async function save() {
    try {
      const { version } = await api.saveResume(content);
      setStatus(`Saved as version ${version}`);
    } catch (e) {
      setStatus(String(e));
    }
  }

  return (
    <main>
      <h2>Master resume</h2>
      <p>{status}</p>
      <p>
        This is the only source of truth. The writer may reorder and rephrase what is here. It may
        never add to it.
      </p>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="Paste your full resume as plain text" />
      <p>
        <button className="primary" onClick={save}>
          Save new version
        </button>
      </p>
    </main>
  );
}
