import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { authClient } from '~/lib/auth-client'
import {
  addDestination,
  addInstance,
  addJob,
  deleteDestination,
  deleteInstance,
  deleteJob,
  getDashboard,
  getUser,
  restoreBackup,
  runJobNow,
  setJobEnabled,
  testDestination,
  testInstance,
  updateInstance,
} from '~/server/fns'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const user = await getUser()
    if (!user) throw redirect({ to: '/login', search: { step: 'password' } })
    if (!user.twoFactorEnabled) throw redirect({ to: '/security' })
    return { user }
  },
  loader: () => getDashboard(),
  component: Dashboard,
})

type Data = Awaited<ReturnType<typeof getDashboard>>

function useAction() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true)
    setError(null)
    try {
      const result = await fn()
      await router.invalidate()
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return { run, error, busy }
}

function Dashboard() {
  const data = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const router = useRouter()
  const anyRunning = data.runs.some((r) => r.status === 'running') || data.restores.some((r) => r.status === 'running')

  useEffect(() => {
    if (!anyRunning) return
    const t = setInterval(() => router.invalidate(), 4000)
    return () => clearInterval(t)
  }, [anyRunning, router])

  return (
    <main>
      <header>
        <h1>Convex Backup Console</h1>
        <div className="row">
          <span className="muted">{user.email}</span>
          <button onClick={async () => { await authClient.signOut(); window.location.href = '/login' }}>Sign out</button>
        </div>
      </header>
      <Instances data={data} />
      <Destinations data={data} />
      <Jobs data={data} />
      <Runs data={data} />
      <Restores data={data} />
    </main>
  )
}

function Instances({ data }: { data: Data }) {
  const add = useServerFn(addInstance)
  const test = useServerFn(testInstance)
  const del = useServerFn(deleteInstance)
  const update = useServerFn(updateInstance)
  const { run, error, busy } = useAction()
  const [status, setStatus] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <section>
      <h2>Convex instances</h2>
      <table>
        <thead><tr><th>Name</th><th>URL</th><th /></tr></thead>
        <tbody>
          {data.instances.map((i) => (
            <tr key={i.id}>
              <td>{i.name} {i.busy && <span className="running">· exporting</span>}{i.restoring && <span className="running">· restoring</span>}</td>
              <td><code>{i.url}</code></td>
              <td className="row">
                <button disabled={busy} onClick={() => run(async () => setStatus(`${i.name}: Convex ${(await test({ data: { id: i.id } })).version}`))}>Test</button>
                <button disabled={busy} onClick={() => setEditing(editing === i.id ? null : i.id)}>Update key</button>
                <button className="danger" disabled={busy} onClick={() => confirm(`Delete ${i.name} and its jobs?`) && run(() => del({ data: { id: i.id } }))}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            void run(async () => {
              const r = await update({ data: { id: editing, url: String(f.get('url')), adminKey: String(f.get('adminKey')) } })
              setStatus(`Updated — Convex ${r.version}`)
              setEditing(null)
            })
          }}
        >
          <strong>Update {data.instances.find((i) => i.id === editing)?.name}</strong>
          <input name="url" defaultValue={data.instances.find((i) => i.id === editing)?.url} required size={32} />
          <input name="adminKey" type="password" placeholder="New admin key" required />
          <button className="primary" disabled={busy}>Save</button>
        </form>
      )}
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          const form = e.currentTarget
          void run(async () => {
            const r = await add({ data: { name: String(f.get('name')), url: String(f.get('url')), adminKey: String(f.get('adminKey')) } })
            setStatus(`Connected — Convex ${r.version}`)
            form.reset()
          })
        }}
      >
        <input name="name" placeholder="Name (e.g. acme-prod)" required />
        <input name="url" placeholder="https://convex-api.example.com" required size={32} />
        <input name="adminKey" type="password" placeholder="Admin key" required />
        <button className="primary" disabled={busy}>Add instance</button>
      </form>
      {status && <p className="muted">{status}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

function Destinations({ data }: { data: Data }) {
  const add = useServerFn(addDestination)
  const test = useServerFn(testDestination)
  const del = useServerFn(deleteDestination)
  const { run, error, busy } = useAction()
  const [kind, setKind] = useState<'s3' | 'local'>('s3')
  const [status, setStatus] = useState<string | null>(null)

  return (
    <section>
      <h2>Destinations</h2>
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Location</th><th /></tr></thead>
        <tbody>
          {data.destinations.map((d) => (
            <tr key={d.id}>
              <td>{d.name}</td>
              <td>{d.kind}</td>
              <td><code>{d.summary}</code></td>
              <td className="row">
                <button disabled={busy} onClick={() => run(async () => { await test({ data: { id: d.id } }); setStatus(`${d.name}: reachable`) })}>Test</button>
                <button className="danger" disabled={busy} onClick={() => confirm(`Delete destination ${d.name}? Stored backups are not deleted.`) && run(() => del({ data: { id: d.id } }))}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault()
          const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
          const form = e.currentTarget
          void run(async () => {
            await add({
              data:
                kind === 'local'
                  ? { kind, name: f.name, root: f.root }
                  : {
                      kind,
                      name: f.name,
                      endpoint: f.endpoint,
                      region: f.region || 'auto',
                      bucket: f.bucket,
                      prefix: f.prefix,
                      forcePathStyle: f.forcePathStyle === 'on',
                      accessKeyId: f.accessKeyId,
                      secretAccessKey: f.secretAccessKey,
                    },
            })
            setStatus('Destination added and reachable')
            form.reset()
          })
        }}
      >
        <select value={kind} onChange={(e) => setKind(e.target.value as 's3' | 'local')}>
          <option value="s3">S3-compatible (S3, R2, B2, MinIO…)</option>
          <option value="local">Local volume</option>
        </select>
        <input name="name" placeholder="Name" required />
        {kind === 'local' ? (
          <input name="root" placeholder="/data/backups" defaultValue="/data/backups" required />
        ) : (
          <>
            <input name="endpoint" placeholder="Endpoint (empty for AWS)" size={36} />
            <input name="region" placeholder="Region (auto)" size={10} />
            <input name="bucket" placeholder="Bucket" required />
            <input name="prefix" placeholder="Prefix (optional)" />
            <input name="accessKeyId" placeholder="Access key ID" required />
            <input name="secretAccessKey" type="password" placeholder="Secret access key" required />
            <label className="muted"><input name="forcePathStyle" type="checkbox" /> path-style</label>
          </>
        )}
        <button className="primary" disabled={busy}>Add destination</button>
      </form>
      {status && <p className="muted">{status}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

function Jobs({ data }: { data: Data }) {
  const add = useServerFn(addJob)
  const runNow = useServerFn(runJobNow)
  const toggle = useServerFn(setJobEnabled)
  const del = useServerFn(deleteJob)
  const { run, error, busy } = useAction()
  const instanceName = (id: string) => data.instances.find((i) => i.id === id)?.name ?? '?'
  const destName = (id: string) => data.destinations.find((d) => d.id === id)?.name ?? '?'

  return (
    <section>
      <h2>Backup jobs</h2>
      <table>
        <thead><tr><th>Name</th><th>Instance</th><th>Destinations</th><th>Schedule</th><th>Keep</th><th /></tr></thead>
        <tbody>
          {data.jobs.map((j) => (
            <tr key={j.id}>
              <td>{j.name}{j.include_storage ? '' : <span className="muted"> · no files</span>}</td>
              <td>{instanceName(j.instance_id)}</td>
              <td>{j.destination_ids.map(destName).join(', ')}</td>
              <td>
                {j.cron ? <code>{j.cron}</code> : <span className="muted">manual</span>}
                {j.next_run && <div className="muted">next {new Date(j.next_run).toLocaleString()}</div>}
                {!j.enabled && <div className="failed">paused</div>}
              </td>
              <td>{j.keep_last ?? '∞'}</td>
              <td className="row">
                <button className="primary" disabled={busy} onClick={() => run(() => runNow({ data: { id: j.id } }))}>Run now</button>
                {j.cron && <button disabled={busy} onClick={() => run(() => toggle({ data: { id: j.id, enabled: !j.enabled } }))}>{j.enabled ? 'Pause' : 'Resume'}</button>}
                <button className="danger" disabled={busy} onClick={() => confirm(`Delete job ${j.name}?`) && run(() => del({ data: { id: j.id } }))}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault()
          const fd = new FormData(e.currentTarget)
          const form = e.currentTarget
          const keep = String(fd.get('keepLast') ?? '')
          void run(async () => {
            await add({
              data: {
                name: String(fd.get('name')),
                instanceId: String(fd.get('instanceId')),
                destinationIds: fd.getAll('destinationIds').map(String),
                includeStorage: fd.get('includeStorage') === 'on',
                cron: String(fd.get('cron') ?? ''),
                keepLast: keep ? Number(keep) : null,
              },
            })
            form.reset()
          })
        }}
      >
        <input name="name" placeholder="Job name" required />
        <select name="instanceId" required>
          {data.instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        {data.destinations.map((d) => (
          <label key={d.id} className="muted"><input type="checkbox" name="destinationIds" value={d.id} /> {d.name}</label>
        ))}
        <input name="cron" placeholder="Cron, e.g. 0 3 * * * (empty = manual)" size={30} />
        <input name="keepLast" type="number" min={1} placeholder="Keep last N" style={{ width: 110 }} />
        <label className="muted"><input name="includeStorage" type="checkbox" defaultChecked /> include file storage</label>
        <button className="primary" disabled={busy || !data.instances.length || !data.destinations.length}>Add job</button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

function Runs({ data }: { data: Data }) {
  const destName = (id: string) => data.destinations.find((d) => d.id === id)?.name ?? '(deleted)'
  const [restoring, setRestoring] = useState<{ runId: string; destinationId: string; label: string } | null>(null)
  return (
    <section>
      <h2>Recent runs</h2>
      <table>
        <thead><tr><th>Started</th><th>Job</th><th>Status</th><th>Size</th><th>Copies</th></tr></thead>
        <tbody>
          {data.runs.map((r) => (
            <tr key={r.id}>
              <td>
                {new Date(r.started_at).toLocaleString()}
                <div className="muted">{r.trigger}{r.finished_at && ` · ${Math.round((r.finished_at - r.started_at) / 1000)}s`}</div>
              </td>
              <td>{r.job_name}<div className="muted">{r.instance_name}</div></td>
              <td className={r.status}>{r.status}{r.error && <div className="error">{r.error}</div>}</td>
              <td>{r.bytes != null ? formatBytes(r.bytes) : ''}</td>
              <td>
                {r.copies.map((c) => (
                  <div key={c.destination_id} className="row">
                    <span className={c.status}>{destName(c.destination_id)}</span>
                    {c.deleted ? <span className="muted">· pruned</span> : null}
                    {c.status === 'ok' && !c.deleted && (
                      <>
                        <a href={`/api/download?run=${r.id}&dest=${c.destination_id}`}>Download</a>
                        <button onClick={() => setRestoring({ runId: r.id, destinationId: c.destination_id, label: `${r.instance_name} · ${new Date(r.started_at).toLocaleString()} · ${destName(c.destination_id)}` })}>
                          Restore…
                        </button>
                      </>
                    )}
                    {c.error && <div className="error">{c.error}</div>}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {restoring && <RestoreForm data={data} source={restoring} onClose={() => setRestoring(null)} />}
    </section>
  )
}

function RestoreForm({ data, source, onClose }: { data: Data; source: { runId: string; destinationId: string; label: string }; onClose: () => void }) {
  const restore = useServerFn(restoreBackup)
  const { run, error, busy } = useAction()
  const [targetId, setTargetId] = useState(data.instances[0]?.id ?? '')
  const target = data.instances.find((i) => i.id === targetId)
  return (
    <form
      className="inline restore"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        void run(async () => {
          await restore({
            data: {
              ...source,
              targetInstanceId: targetId,
              mode: String(f.get('mode')) as 'replaceAll',
              confirm: String(f.get('confirm')),
            },
          })
          onClose()
        })
      }}
    >
      <strong>Restore {source.label}</strong>
      <span>into</span>
      <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
        {data.instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
      <select name="mode" defaultValue="replaceAll">
        <option value="replaceAll">Replace all tables (full restore)</option>
        <option value="replace">Replace tables in the backup only</option>
        <option value="append">Append documents</option>
        <option value="requireEmpty">Only if target is empty</option>
      </select>
      <input name="confirm" placeholder={`Type "${target?.name ?? ''}" to confirm`} required autoComplete="off" />
      <button className="danger" disabled={busy || !target}>Restore — overwrites data</button>
      <button type="button" onClick={onClose}>Cancel</button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}

function Restores({ data }: { data: Data }) {
  if (data.restores.length === 0) return null
  return (
    <section>
      <h2>Restores</h2>
      <table>
        <thead><tr><th>Started</th><th>Backup</th><th>Into</th><th>Mode</th><th>Status</th></tr></thead>
        <tbody>
          {data.restores.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.started_at).toLocaleString()}<div className="muted">{r.actor}</div></td>
              <td><code>{r.object_key}</code></td>
              <td>{r.target_name}</td>
              <td>{r.mode}</td>
              <td className={r.status}>
                {r.status}{r.rows_written != null && ` · ${r.rows_written} docs`}
                {r.confirm_message && <div className="muted">{r.confirm_message}</div>}
                {r.error && <div className="error">{r.error}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function formatBytes(n: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`
}
