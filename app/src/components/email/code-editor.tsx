import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { useTheme } from 'next-themes'

/** CodeMirror for Markdown bodies and full-HTML templates (client-only). */
export function CodeEditor({
  value,
  onChange,
  language,
  minHeight,
  onView,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  language: 'markdown' | 'html'
  minHeight: string
  onView: (view: EditorView) => void
  ariaLabel: string
}) {
  const { resolvedTheme } = useTheme()
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      minHeight={minHeight}
      maxHeight="70vh"
      basicSetup={{ foldGutter: false, highlightActiveLine: false, lineNumbers: language === 'html' }}
      extensions={[language === 'html' ? html() : markdown(), EditorView.lineWrapping, EditorView.contentAttributes.of({ 'aria-label': ariaLabel })]}
      onCreateEditor={onView}
      className="overflow-hidden rounded-md border text-sm [&_.cm-editor]:outline-none [&_.cm-focused]:ring-ring/50 [&_.cm-focused]:ring-[3px]"
    />
  )
}
