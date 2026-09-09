import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type {
  JsonArray,
  JsonObject,
  JsonValue,
} from '@koshko/protocol';
import {
  JsonEditor,
  type CollapseState,
  type ExternalTriggers,
  type ThemeInput,
} from 'json-edit-react';

type SearchScope = 'all' | 'key' | 'value';
type NodePath = Array<string | number>;

const ROOT_PATH: NodePath = [];
const SEARCH_SCOPES: Array<{ value: SearchScope; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'key', label: 'Keys' },
  { value: 'value', label: 'Values' },
];

const viewerTheme: ThemeInput = {
  container: {
    width: '100%',
    padding: 0,
    backgroundColor: 'transparent',
    color: 'var(--noir-ink)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  property: { color: 'var(--noir-ink)', fontWeight: 700 },
  bracket: { color: 'var(--noir-muted)', fontWeight: 700 },
  itemCount: { color: 'var(--noir-muted)' },
  string: { color: 'var(--state-string)' },
  number: { color: 'var(--state-number)' },
  boolean: { color: 'var(--state-boolean)', fontWeight: 700 },
  null: { color: 'var(--state-null)', fontWeight: 700 },
  iconCollection: { color: 'var(--noir-accent)' },
  iconCopy: { color: 'var(--noir-accent)' },
};

export function GlobalStateViewer({ state }: { state: JsonObject }): ReactElement {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [externalTriggers, setExternalTriggers] = useState<ExternalTriggers>();
  const expandedPaths = useRef(new Set<string>());
  const normalizedQuery = query.trim();
  const searchActive = normalizedQuery.length > 0;
  const hasMatches = !searchActive || hasSearchMatch(state, normalizedQuery, scope);

  useEffect(() => {
    const containerPaths = collectContainerPaths(state);
    const validPaths = new Set(containerPaths.map(pathKey));
    for (const expandedPath of expandedPaths.current) {
      if (!validPaths.has(expandedPath)) {
        expandedPaths.current.delete(expandedPath);
      }
    }

    const collapse = searchActive
      ? {
          path: ROOT_PATH,
          collapsed: false,
          includeChildren: true,
        }
      : containerPaths.map((path) => ({
          path,
          collapsed: !expandedPaths.current.has(pathKey(path)),
          includeChildren: false,
        }));

    setExternalTriggers({ collapse });
  }, [searchActive, state]);

  const handleCollapse = (change: CollapseState): void => {
    if (searchActive) return;

    const affectedPaths = change.includeChildren
      ? collectContainerPaths(getValueAtPath(state, change.path), change.path)
      : [change.path];

    for (const path of affectedPaths) {
      const key = pathKey(path);
      if (change.collapsed) {
        expandedPaths.current.delete(key);
      } else {
        expandedPaths.current.add(key);
      }
    }
  };

  return (
    <div className="global-state" data-testid="global-state">
      <div className="state-search" role="search" aria-label="Search global state">
        <label className="state-search-input">
          <span className="sr-only">Search global state nodes</span>
          <input
            type="search"
            value={query}
            placeholder="Search state…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="state-search-scope">
          <span>In</span>
          <select
            aria-label="Search scope"
            value={scope}
            onChange={(event) => setScope(event.target.value as SearchScope)}
          >
            {SEARCH_SCOPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ghost state-search-clear"
          disabled={!query}
          onClick={() => setQuery('')}
        >
          Clear
        </button>
      </div>
      <div className="state-tree" aria-label="Selected global state">
        {searchActive && !hasMatches ? (
          <p className="state-search-empty" role="status">
            No state nodes match “{normalizedQuery}”.
          </p>
        ) : (
          <JsonEditor
            data={state}
            rootName="state"
            viewOnly
            enableClipboard
            showIconTooltips
            collapse
            collapseAnimationTime={0}
            collapseClickZones={['left', 'header', 'property']}
            searchText={searchActive ? normalizedQuery : undefined}
            searchFilter={scope}
            searchDebounceTime={0}
            externalTriggers={externalTriggers}
            onCollapse={handleCollapse}
            theme={viewerTheme}
            minWidth="100%"
            maxWidth="100%"
            rootFontSize="12px"
          />
        )}
      </div>
    </div>
  );
}

function collectContainerPaths(value: unknown, basePath: NodePath = []): NodePath[] {
  if (!isContainer(value)) return [];

  const paths = [basePath];
  for (const [key, child] of Object.entries(value)) {
    if (isContainer(child)) {
      const childKey = Array.isArray(value) ? Number(key) : key;
      paths.push(...collectContainerPaths(child, [...basePath, childKey]));
    }
  }
  return paths;
}

function getValueAtPath(state: JsonObject, path: NodePath): JsonValue | JsonObject {
  let value: JsonValue | JsonObject = state;
  for (const segment of path) {
    if (!isContainer(value)) break;
    value = Array.isArray(value)
      ? value[Number(segment)]
      : value[String(segment)];
  }
  return value;
}

function isContainer(value: unknown): value is JsonObject | JsonArray {
  return value !== null && typeof value === 'object';
}

function pathKey(path: NodePath): string {
  return JSON.stringify(path);
}

function hasSearchMatch(
  value: JsonObject | JsonArray,
  query: string,
  scope: SearchScope,
): boolean {
  const needle = query.toLowerCase();

  return Object.entries(value).some(([key, child]) => {
    const keyMatches = scope !== 'value' && key.toLowerCase().includes(needle);
    const valueMatches = scope !== 'key' && !isContainer(child)
      && String(child).toLowerCase().includes(needle);

    return keyMatches
      || valueMatches
      || (isContainer(child) && hasSearchMatch(child, query, scope));
  });
}
