import { ClientOnly, createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import type { EditorView } from '@uiw/react-codemirror'
import { ArrowLeft, Braces, Code2, History, LayoutTemplate, Monitor, RotateCcw, Save, Send, Smartphone, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { Confirm } from '~/components/confirm'
import { CodeEditor } from '~/components/email/code-editor'
import { PageBody, PageHeader } from '~/components/page'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '~/components/ui/field'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Switch } from '~/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '~/components/ui/tabs'
import { EMAIL_TYPE_KEYS, EMAIL_TYPES, type EmailType, type Structured, type VariableDoc } from '~/lib/email-types'
import { timeAgo } from '~/lib/format'
import { useAction } from '~/lib/use-action'
import { exportTemplateHtml, getEmailTemplate, previewEmail, resetEmailTemplate, revertEmailTemplate, saveEmailTemplate, sendTestEmail } from '~/server/email-fns'

export const Route = createFileRoute('/_app/emails/$type')({
  params: { parse: (p) => ({ type: z.enum(EMAIL_TYPE_KEYS as [EmailType, ...EmailType[]]).parse(p.type) }) },
  validateSearch: z.object({ scope: z.enum(['workspace', 'platform']).optional() }),
  loaderDeps: ({ search }) => ({ scope: search.scope ?? 'workspace' }),
  loader: ({ params, deps }) => getEmailTemplate({ data: { type: params.type, scope: deps.scope } }),
  component: EditorPage,
})

type Data = Awaited<ReturnType<typeof getEmailTemplate>>
type Template = Data['template']
type Preview = Awaited<ReturnType<typeof previewEmail>>

function EditorPage() {
  const data = Route.useLoaderData()
  // Remount the editor whenever the saved template changes (save, reset, revert).
  return <Editor key={`${data.type}:${data.scope}:${data.versions[0]?.id ?? 0}:${data.source}`} data={data} />
}

/** Text inserted for a variable: lists become loops, dates and sizes get their filter. */
function snippet(v: VariableDoc) {
  if (v.description.startsWith('List:')) {
    const first = v.description.slice(5).split(',')[0].trim()
    return `{% for item in ${v.name} %}\n- {{ item.${first} }}\n{% endfor %}`
  }
  if (v.description.includes('| date')) return `{{ ${v.name} | date: "%-d %b %Y %H:%M" }}`
  if (v.description.includes('| bytes')) return `{{ ${v.name} | bytes }}`
  return `{{ ${v.name} }}`
}

type Target = { kind: 'input'; key: 'subject' | 'preheader' | 'heading' | 'buttonLabel' | 'buttonUrl' | 'htmlSubject'; el: HTMLInputElement } | { kind: 'cm'; view: EditorView }

function Editor({ data }: { data: Data }) {
  const router = useRouter()
  const save = useServerFn(saveEmailTemplate)
  const reset = useServerFn(resetEmailTemplate)
  const preview = useServerFn(previewEmail)
  const sendTest = useServerFn(sendTestEmail)
  const exportHtml = useServerFn(exportTemplateHtml)
  const { run, pending } = useAction()

  const initial = data.template
  const structuredBase: Structured =
    initial.mode === 'structured' ? initial.content : data.defaultTemplate.mode === 'structured' ? data.defaultTemplate.content : EMAIL_TYPES[data.type].defaults
  const [mode, setMode] = useState<Template['mode']>(initial.mode)
  const [content, setContent] = useState<Structured>(structuredBase)
  const [htmlSubject, setHtmlSubject] = useState(initial.mode === 'html' ? initial.subject : structuredBase.subject)
  const [html, setHtml] = useState(initial.mode === 'html' ? initial.html : '')
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [view, setView] = useState<'html' | 'text'>('html')
  const [sample, setSample] = useState<'sample' | 'real'>('sample')
  const [result, setResult] = useState<Preview | null>(null)
  const [history, setHistory] = useState(false)
  const target = useRef<Target | null>(null)
  const bodyView = useRef<EditorView | null>(null)

  const current: Template = mode === 'html' ? { mode: 'html', subject: htmlSubject, html } : { mode: 'structured', content }
  const savedJson = JSON.stringify(initial)
  const dirty = JSON.stringify(current) !== savedJson
  const isPlatform = data.scope === 'platform'
  const back = isPlatform ? '/platform' : '/emails'

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Live preview, rendered on the server (same code path as real sends).
  const seq = useRef(0)
  const currentJson = JSON.stringify(current)
  useEffect(() => {
    const id = ++seq.current
    const t = setTimeout(async () => {
      try {
        const r = await preview({ data: { type: data.type, scope: data.scope, template: JSON.parse(currentJson), data: sample } })
        if (id === seq.current) setResult(r)
      } catch (err) {
        if (id === seq.current) setResult({ ok: false, error: err instanceof Error ? err.message : String(err), warnings: [] })
      }
    }, 350)
    return () => clearTimeout(t)
  }, [currentJson, sample, data.type, data.scope, preview])

  function insert(text: string) {
    const t = target.current ?? (bodyView.current ? { kind: 'cm' as const, view: bodyView.current } : null)
    if (!t) return
    if (t.kind === 'cm') {
      const sel = t.view.state.selection.main
      t.view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length } })
      t.view.focus()
      return
    }
    const el = t.el
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    const next = el.value.slice(0, start) + text + el.value.slice(end)
    if (t.key === 'htmlSubject') setHtmlSubject(next)
    else setContent((c) => ({ ...c, [t.key]: next }))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + text.length, start + text.length)
    })
  }

  const input = (key: Exclude<Target, { kind: 'cm' }>['key'], label: string, opts: { placeholder?: string; description?: string } = {}) => {
    const value = key === 'htmlSubject' ? htmlSubject : content[key]
    return (
      <Field>
        <FieldLabel htmlFor={`f-${key}`}>{label}</FieldLabel>
        <Input
          id={`f-${key}`}
          value={value}
          placeholder={opts.placeholder}
          onFocus={(e) => (target.current = { kind: 'input', key, el: e.currentTarget })}
          onChange={(e) => (key === 'htmlSubject' ? setHtmlSubject(e.target.value) : setContent((c) => ({ ...c, [key]: e.target.value })))}
          className={key === 'buttonUrl' ? 'font-mono text-xs' : undefined}
        />
        {opts.description && <FieldDescription>{opts.description}</FieldDescription>}
      </Field>
    )
  }

  const editorFallback = <div className="bg-muted/40 h-48 animate-pulse rounded-md border" />

  return (
    <>
      <PageHeader
        title={`${data.label}${isPlatform ? ' · platform default' : ''}`}
        description={data.description}
        actions={
          <>
            <Button asChild variant="ghost"><Link to={back}><ArrowLeft /> Back</Link></Button>
            <Button variant="outline" onClick={() => setHistory(true)} disabled={!data.versions.length}><History /> History</Button>
            {(isPlatform ? data.source === 'platform' : data.source === 'workspace') && (
              <Confirm
                trigger={<Button variant="outline"><RotateCcw /> Reset</Button>}
                title="Reset to the default?"
                description={isPlatform ? 'Workspaces without their own version will get the built-in template again.' : 'This workspace will use the platform default again. Your version stays in History.'}
                action="Reset"
                onConfirm={() => run(() => reset({ data: { type: data.type, scope: data.scope } }), { success: 'Reset to default' })}
              />
            )}
            <Button variant="outline" disabled={pending || (result != null && !result.ok)} onClick={() => run(() => sendTest({ data: { type: data.type, scope: data.scope, template: current, data: sample } }), { success: (r) => `Test sent to ${r.to}` })}>
              <Send /> Send test to me
            </Button>
            <Button disabled={pending || !dirty} onClick={() => run(() => save({ data: { type: data.type, scope: data.scope, template: current } }), { success: 'Template saved' })}>
              <Save /> Save
            </Button>
          </>
        }
      />
      <PageBody>
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">Content</CardTitle>
                {(data.canHtml || mode === 'html') && (
                  <Tabs value={mode} onValueChange={(m) => setMode(m as Template['mode'])}>
                    <TabsList>
                      <TabsTrigger value="structured"><LayoutTemplate /> Branded layout</TabsTrigger>
                      <TabsTrigger value="html" disabled={!data.canHtml}><Code2 /> Full HTML</TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}
              </CardHeader>
              <CardContent className="pb-6">
                {mode === 'structured' ? (
                  <FieldGroup>
                    {input('subject', 'Subject')}
                    {input('preheader', 'Preview text', { description: 'Shown after the subject in most inboxes.' })}
                    {input('heading', 'Heading')}
                    <Field>
                      <FieldLabel>Message</FieldLabel>
                      <ClientOnly fallback={editorFallback}>
                        <CodeEditor
                          ariaLabel="Message (Markdown)"
                          language="markdown"
                          minHeight="12rem"
                          value={content.body}
                          onChange={(v) => setContent((c) => ({ ...c, body: v }))}
                          onView={(v) => {
                            bodyView.current = v
                            v.contentDOM.addEventListener('focus', () => (target.current = { kind: 'cm', view: v }))
                          }}
                        />
                      </ClientOnly>
                      <FieldDescription>Markdown: **bold**, _italic_, [links](https://…), lists and &gt; quotes. Values are escaped automatically.</FieldDescription>
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {input('buttonLabel', 'Button label', { placeholder: 'Leave empty for no button' })}
                      {input('buttonUrl', 'Button link')}
                    </div>
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldLabel htmlFor="details">Show the details block</FieldLabel>
                        <FieldDescription>{detailsHint(data.type)}</FieldDescription>
                      </FieldContent>
                      <Switch id="details" checked={content.showDetails} onCheckedChange={(v) => setContent((c) => ({ ...c, showDetails: v }))} />
                    </Field>
                  </FieldGroup>
                ) : (
                  <FieldGroup>
                    {input('htmlSubject', 'Subject')}
                    <Field>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <FieldLabel>HTML</FieldLabel>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={async () => {
                            const r = await run(() => exportHtml({ data: { type: data.type, content } }))
                            if (r) {
                              setHtml(r.html)
                              setHtmlSubject(content.subject)
                              toast.success('Loaded the branded layout as HTML')
                            }
                          }}
                        >
                          <LayoutTemplate /> Start from current design
                        </Button>
                      </div>
                      <ClientOnly fallback={editorFallback}>
                        <CodeEditor
                          ariaLabel="HTML"
                          language="html"
                          minHeight="24rem"
                          value={html}
                          onChange={setHtml}
                          onView={(v) => {
                            bodyView.current = v
                            v.contentDOM.addEventListener('focus', () => (target.current = { kind: 'cm', view: v }))
                          }}
                        />
                      </ClientOnly>
                      <FieldDescription>
                        Replaces the whole email. Use <code>cid:logo</code> as an image source for the workspace logo. Scripts, forms, iframes and event handlers are removed when you save,
                        a plain-text version is generated, and if the template ever fails to render the default is sent instead (and noted in the audit log).
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Braces className="size-4" /> Variables</CardTitle>
              </CardHeader>
              <CardContent className="pb-6">
                <p className="text-muted-foreground mb-3 text-xs">Click to insert at the cursor. Filters: <code>| date: "%-d %b %H:%M"</code>, <code>| bytes</code>, <code>| default: "…"</code>, <code>| upcase</code>.</p>
                <div className="grid gap-1 sm:grid-cols-2">
                  {data.variables.map((v) => (
                    <button
                      key={v.name}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insert(snippet(v))}
                      className="hover:bg-muted focus-visible:ring-ring/50 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-[3px]"
                    >
                      <code className="text-xs font-medium">{v.name}</code>
                      <span className="text-muted-foreground block text-xs">{v.description}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
          <Card className="gap-0 py-0 xl:sticky xl:top-4">
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
              <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
                <TabsList>
                  <TabsTrigger value="html">HTML</TabsTrigger>
                  <TabsTrigger value="text">Plain text</TabsTrigger>
                </TabsList>
              </Tabs>
              <Tabs value={device} onValueChange={(v) => setDevice(v as typeof device)}>
                <TabsList>
                  <TabsTrigger value="desktop" aria-label="Desktop"><Monitor /></TabsTrigger>
                  <TabsTrigger value="mobile" aria-label="Mobile"><Smartphone /></TabsTrigger>
                </TabsList>
              </Tabs>
              {data.hasRealData && (
                <Select value={sample} onValueChange={(v) => setSample(v as typeof sample)}>
                  <SelectTrigger size="sm" className="ml-auto w-36" aria-label="Preview data"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sample">Sample data</SelectItem>
                    <SelectItem value="real">Real data</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            {result?.ok && (
              <div className="border-b px-4 py-2 text-sm">
                <span className="text-muted-foreground">Subject: </span>
                <span className="font-medium" data-testid="preview-subject">{result.subject}</span>
              </div>
            )}
            {result && result.warnings.length > 0 && (
              <div className="space-y-1 border-b bg-amber-500/5 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
                {result.warnings.map((w) => <div key={w} className="flex items-center gap-1.5"><TriangleAlert className="size-3" /> {w}</div>)}
              </div>
            )}
            <div className="bg-muted/40 flex justify-center p-4">
              {!result ? (
                <div className="bg-background h-[640px] w-full animate-pulse rounded-md" />
              ) : !result.ok ? (
                <div className="text-destructive w-full rounded-md border border-destructive/30 bg-destructive/5 p-4 font-mono text-xs whitespace-pre-wrap">{result.error}</div>
              ) : view === 'html' ? (
                <iframe
                  title="Email preview"
                  sandbox=""
                  srcDoc={result.html}
                  className="bg-background h-[640px] rounded-md border shadow-sm transition-[width]"
                  style={{ width: device === 'mobile' ? 375 : '100%' }}
                />
              ) : (
                <pre className="bg-background h-[640px] w-full overflow-auto rounded-md border p-4 text-xs whitespace-pre-wrap" style={{ maxWidth: device === 'mobile' ? 375 : undefined }}>
                  {result.text}
                </pre>
              )}
            </div>
          </Card>
        </div>
      </PageBody>
      {history && <HistoryDialog data={data} onClose={() => setHistory(false)} onLoaded={() => void router.invalidate()} />}
    </>
  )
}

function detailsHint(type: EmailType) {
  if (type.startsWith('backup_')) return 'Instance, job, timing, size and each destination copy.'
  if (type === 'digest') return 'A table of every instance with its last good backup, plus recent failures.'
  return 'This email has no details block.'
}

function HistoryDialog({ data, onClose, onLoaded }: { data: Data; onClose: () => void; onLoaded: () => void }) {
  const revert = useServerFn(revertEmailTemplate)
  const { run, pending } = useAction()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>History</DialogTitle>
          <DialogDescription>The last 20 saved versions of this template.</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-md border">
          {data.versions.map((v, i) => (
            <li key={v.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{timeAgo(v.saved_at)}</span>
                  {v.template.mode === 'html' && <Badge variant="secondary">HTML</Badge>}
                  {i === 0 && <Badge variant="outline">Current</Badge>}
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {v.saved_by}
                  {v.note && ` · ${v.note}`} · “{v.template.mode === 'html' ? v.template.subject : v.template.content.subject}”
                </div>
              </div>
              {i > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending || (v.template.mode === 'html' && !data.canHtml)}
                  onClick={async () => {
                    const ok = await run(() => revert({ data: { type: data.type, scope: data.scope, versionId: v.id } }), { success: 'Reverted' })
                    if (ok !== undefined) {
                      onClose()
                      onLoaded()
                    }
                  }}
                >
                  Revert
                </Button>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
