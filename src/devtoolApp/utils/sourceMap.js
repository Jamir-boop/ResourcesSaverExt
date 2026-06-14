import { resolveURLToPath } from './url';

const DEBUG_FILE_PATH = '_ResourceSaverDebug/debug.json';
const INLINE_SOURCE_MAP_ROOT = '_SourceMaps/inline';
const RELATIVE_SOURCE_ROOT = '_SourceMaps';
const SOURCE_MAPPING_URL_REGEX = /(?:\/\/[#@]\s*sourceMappingURL=([^\s]+)|\/\*[#@]\s*sourceMappingURL=([^*]+?)\s*\*\/)/g;
const SOURCE_MAP_PREFIX_REGEX = /^\)\]\}'\n/;
const ABSOLUTE_URL_REGEX = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

const isHttpUrl = (url) => /^https?:\/\//i.test(url);

const stripQueryAndHash = (value = '') => value.split('#')[0].split('?')[0];

const decodePath = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const sanitizeZipPath = (value) => {
  let filepath = decodePath(value)
    .replace(/\\/g, '/')
    .replace(/:|=|\*|\.$|"|'|\?|~|\||<|>/g, '')
    .replace(/\/\//g, '/')
    .replace(/(\s|\.)\//g, '/')
    .replace(/\/(\s|\.)/g, '/');

  while (filepath.includes('//')) {
    filepath = filepath.replace('//', '/');
  }

  if (filepath.charAt(0) === '/') {
    filepath = filepath.slice(1);
  }

  return filepath;
};

const normalizePathSegments = (value) => {
  const parts = value.replace(/\\/g, '/').split('/');
  const normalized = [];

  parts.forEach((part) => {
    if (!part || part === '.') {
      return;
    }
    if (part === '..') {
      normalized.pop();
      return;
    }
    normalized.push(part);
  });

  return normalized.join('/');
};

const getSafeBundleName = (sourceMapUrl = 'source-map') => {
  const cleanUrl = stripQueryAndHash(sourceMapUrl);
  const lastPath = cleanUrl.split('/').filter(Boolean).pop() || 'source-map';
  return sanitizeZipPath(lastPath) || 'source-map';
};

const getSourceUrl = (sourceRoot, source) => {
  if (!sourceRoot) {
    return source || '';
  }
  if (ABSOLUTE_URL_REGEX.test(source) || source.startsWith('data:')) {
    return source;
  }
  if (sourceRoot.endsWith('/') || source.startsWith('/')) {
    return `${sourceRoot}${source}`;
  }
  return `${sourceRoot}/${source}`;
};

const isRelativeSource = (sourceUrl) => !sourceUrl.startsWith('data:') && !ABSOLUTE_URL_REGEX.test(sourceUrl);

const absoluteNonHttpPath = (sourceUrl) => {
  const cleanUrl = stripQueryAndHash(sourceUrl);
  const match = cleanUrl.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/);

  if (!match) {
    return cleanUrl;
  }

  return `${match[1].toLowerCase()}/${match[2]}`;
};

export const resolveSourceMapSourceToPath = (sourceUrl, fallbackIndex = 0, sourceMapUrl = '') => {
  let sourcePath;

  if (!sourceUrl || sourceUrl.startsWith('data:')) {
    sourcePath = `${RELATIVE_SOURCE_ROOT}/${getSafeBundleName(sourceMapUrl)}/source-${fallbackIndex}.txt`;
  } else if (isRelativeSource(sourceUrl)) {
    sourcePath = `${RELATIVE_SOURCE_ROOT}/${getSafeBundleName(sourceMapUrl)}/${sourceUrl}`;
  } else if (isHttpUrl(sourceUrl)) {
    sourcePath = resolveURLToPath(sourceUrl).path;
  } else {
    sourcePath = absoluteNonHttpPath(sourceUrl);
  }

  const filepath = sanitizeZipPath(normalizePathSegments(sourcePath));
  const filename = filepath.substring(filepath.lastIndexOf('/') + 1) || `source-${fallbackIndex}.txt`;

  return {
    path: filepath || `${RELATIVE_SOURCE_ROOT}/${getSafeBundleName(sourceMapUrl)}/source-${fallbackIndex}.txt`,
    name: filename,
    dataURI: false,
  };
};

export const inferSourceMapSourceType = (path) => {
  const ext = (path.match(/\.([0-9a-z]+)$/i)?.[1] || '').toLowerCase();

  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
    case 'ts':
    case 'tsx':
      return 'text/javascript';
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return 'text/css';
    case 'json':
      return 'application/json';
    case 'html':
    case 'htm':
      return 'text/html';
    default:
      return 'text/plain';
  }
};

const parseDataUrl = (dataUrl) => {
  const commaIndex = dataUrl.indexOf(',');

  if (!dataUrl.startsWith('data:') || commaIndex === -1) {
    return null;
  }

  const meta = dataUrl.slice(5, commaIndex);
  const body = dataUrl.slice(commaIndex + 1);

  if (meta.toLowerCase().includes(';base64')) {
    try {
      return atob(decodeURIComponent(body));
    } catch {
      return null;
    }
  }

  return decodePath(body);
};

export const resolveTextContent = async (content, encoding) => {
  if (content == null) {
    return null;
  }

  if (typeof Blob !== 'undefined' && content instanceof Blob) {
    return content.text();
  }

  if (typeof content !== 'string') {
    return null;
  }

  if (encoding === 'base64') {
    try {
      return atob(content);
    } catch {
      return content;
    }
  }

  return content;
};

export const getSourceMappingUrls = (content) => {
  const urls = [];
  let match;

  SOURCE_MAPPING_URL_REGEX.lastIndex = 0;

  while ((match = SOURCE_MAPPING_URL_REGEX.exec(content))) {
    const url = (match[1] || match[2] || '').trim();
    if (url) {
      urls.push(url);
    }
  }

  return urls;
};

const getSourceMapHeaderUrls = (resource) => {
  const headers = resource.origin?.response?.headers || [];

  return headers
    .filter((header) => {
      const name = header.name?.toLowerCase();
      return name === 'sourcemap' || name === 'x-sourcemap';
    })
    .map((header) => header.value)
    .filter(Boolean);
};

const isSourceMapUrl = (url = '') => stripQueryAndHash(url).toLowerCase().endsWith('.map');

const isSourceMapMime = (type = '') => type.toLowerCase().includes('source-map');

const parseSourceMapText = (content) => {
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content.replace(SOURCE_MAP_PREFIX_REGEX, ''));
  } catch {
    return null;
  }
};

const flattenSourceMaps = (sourceMap) => {
  if (!sourceMap) {
    return [];
  }

  if (Array.isArray(sourceMap.sections)) {
    return sourceMap.sections.flatMap((section) => flattenSourceMaps(section.map));
  }

  return [sourceMap];
};

const resolveFetchableUrl = (sourceUrl, sourceMapUrl) => {
  if (isHttpUrl(sourceUrl)) {
    return sourceUrl;
  }

  if (!sourceUrl.startsWith('data:') && !ABSOLUTE_URL_REGEX.test(sourceUrl) && isHttpUrl(sourceMapUrl)) {
    try {
      return new URL(sourceUrl, sourceMapUrl).href;
    } catch {
      return null;
    }
  }

  return null;
};

const resolveSourceMapUrl = (mapUrl, resourceUrl) => {
  if (!mapUrl) {
    return null;
  }

  if (mapUrl.startsWith('data:')) {
    return mapUrl;
  }

  if (isHttpUrl(mapUrl)) {
    return mapUrl;
  }

  if (mapUrl.startsWith('//') && isHttpUrl(resourceUrl)) {
    try {
      const baseUrl = new URL(resourceUrl);
      return `${baseUrl.protocol}${mapUrl}`;
    } catch {
      return null;
    }
  }

  if (isHttpUrl(resourceUrl)) {
    try {
      return new URL(mapUrl, resourceUrl).href;
    } catch {
      return null;
    }
  }

  return null;
};

const fetchText = async (url) => {
  const response = await fetch(url, { credentials: 'include' });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
};

const getResourceKey = (url) => stripQueryAndHash(url || '');

const indexResourcesByUrl = (resources) => {
  const byExactUrl = {};
  const byCleanUrl = {};

  resources.forEach((resource) => {
    if (!resource?.url) {
      return;
    }
    byExactUrl[resource.url] = resource;
    byCleanUrl[getResourceKey(resource.url)] = resource;
  });

  return { byExactUrl, byCleanUrl };
};

const findResourceByUrl = (url, index) => index.byExactUrl[url] || index.byCleanUrl[getResourceKey(url)];

const getRawSourceMapPath = (sourceMapUrl, scriptUrl, index) => {
  if (sourceMapUrl.startsWith('data:')) {
    const bundleName = getSafeBundleName(scriptUrl || `inline-${index}`);
    const filename = bundleName.endsWith('.map') ? bundleName : `${bundleName}.map`;
    const path = sanitizeZipPath(`${INLINE_SOURCE_MAP_ROOT}/${filename}`);
    return { path, name: path.substring(path.lastIndexOf('/') + 1), dataURI: false };
  }

  return resolveURLToPath(sourceMapUrl, 'application/json', '{}');
};

const pushUniqueCandidate = (candidates, candidate) => {
  const key = candidate.sourceMapUrl || candidate.rawMapUrl;

  if (!candidates.some((item) => (item.sourceMapUrl || item.rawMapUrl) === key)) {
    candidates.push(candidate);
  }
};

const collectSourceMapCandidates = async (resources, debuggerResult, debug, resourceIndex) => {
  const candidates = [];

  (debuggerResult?.scripts || []).forEach((script) => {
    if (script.sourceMapURL) {
      pushUniqueCandidate(candidates, {
        sourceMapUrl: resolveSourceMapUrl(script.sourceMapURL, script.url) || script.sourceMapURL,
        rawMapUrl: script.sourceMapURL,
        scriptUrl: script.url,
        source: 'debugger',
        targetType: script.targetType,
        sessionId: script.sessionId,
      });
    }
    if (script.hasSourceURL && !script.sourceMapURL) {
      debug.sourceUrlOnlyScripts.push({
        url: script.url,
        scriptId: script.scriptId,
        targetType: script.targetType,
      });
    }
  });

  for (const resource of resources) {
    const content = await resolveTextContent(resource.content, resource.encoding);

    if (isSourceMapUrl(resource.url) || isSourceMapMime(resource.type)) {
      pushUniqueCandidate(candidates, {
        sourceMapUrl: resource.url,
        scriptUrl: '',
        source: 'resource',
      });
    }

    if (content) {
      getSourceMappingUrls(content).forEach((sourceMapUrl) => {
        pushUniqueCandidate(candidates, {
          sourceMapUrl: resolveSourceMapUrl(sourceMapUrl, resource.url) || sourceMapUrl,
          rawMapUrl: sourceMapUrl,
          scriptUrl: resource.url,
          source: 'comment',
        });
      });
    }

    getSourceMapHeaderUrls(resource).forEach((sourceMapUrl) => {
      pushUniqueCandidate(candidates, {
        sourceMapUrl: resolveSourceMapUrl(sourceMapUrl, resource.url) || sourceMapUrl,
        rawMapUrl: sourceMapUrl,
        scriptUrl: resource.url,
        source: 'header',
      });
    });
  }

  candidates.forEach((candidate) => {
    const resource = findResourceByUrl(candidate.sourceMapUrl, resourceIndex);
    debug.sourceMaps.found.push({
      sourceMapUrl: candidate.sourceMapUrl,
      rawMapUrl: candidate.rawMapUrl,
      scriptUrl: candidate.scriptUrl,
      source: candidate.source,
      hasCapturedResource: !!resource,
    });
  });

  return candidates;
};

const loadSourceMapCandidate = async (candidate, index, debug, resourceIndex) => {
  const sourceMapUrl = candidate.sourceMapUrl;

  if (!sourceMapUrl) {
    return null;
  }

  if (sourceMapUrl.startsWith('data:')) {
    const content = parseDataUrl(sourceMapUrl);
    debug.sourceMaps.loaded.push({
      sourceMapUrl: `${candidate.scriptUrl || 'inline'}#sourceMappingURL`,
      scriptUrl: candidate.scriptUrl,
      source: candidate.source,
      loadedFrom: 'inline',
      ok: !!content,
    });
    return content
      ? {
          url: sourceMapUrl,
          saveAs: getRawSourceMapPath(sourceMapUrl, candidate.scriptUrl, index),
          content,
          loadedFrom: 'inline',
        }
      : null;
  }

  const resource = findResourceByUrl(sourceMapUrl, resourceIndex);
  const resourceContent = resource ? await resolveTextContent(resource.content, resource.encoding) : null;

  if (resourceContent) {
    debug.sourceMaps.loaded.push({
      sourceMapUrl,
      scriptUrl: candidate.scriptUrl,
      source: candidate.source,
      loadedFrom: resource.source || 'resource',
      ok: true,
    });
    return {
      url: sourceMapUrl,
      saveAs: getRawSourceMapPath(sourceMapUrl, candidate.scriptUrl, index),
      content: resourceContent,
      loadedFrom: resource.source || 'resource',
    };
  }

  try {
    const fetchedContent = await fetchText(sourceMapUrl);
    debug.sourceMaps.loaded.push({
      sourceMapUrl,
      scriptUrl: candidate.scriptUrl,
      source: candidate.source,
      loadedFrom: 'fetch',
      ok: true,
    });
    return {
      url: sourceMapUrl,
      saveAs: getRawSourceMapPath(sourceMapUrl, candidate.scriptUrl, index),
      content: fetchedContent,
      loadedFrom: 'fetch',
    };
  } catch (err) {
    debug.sourceMaps.errors.push({
      sourceMapUrl,
      scriptUrl: candidate.scriptUrl,
      source: candidate.source,
      error: err.message,
    });
    return null;
  }
};

const sourceMapToResources = async (sourceMap, sourceMapUrl, debug) => {
  const resources = [];

  for (const currentMap of flattenSourceMaps(sourceMap)) {
    const sources = Array.isArray(currentMap.sources) ? currentMap.sources : [];
    const sourcesContent = Array.isArray(currentMap.sourcesContent) ? currentMap.sourcesContent : [];

    for (let index = 0; index < sources.length; index++) {
      const source = sources[index];
      const sourceUrl = getSourceUrl(currentMap.sourceRoot, source);
      const saveAs = resolveSourceMapSourceToPath(sourceUrl, index, sourceMapUrl);
      const hasInlineContent = Object.prototype.hasOwnProperty.call(sourcesContent, index) && sourcesContent[index] != null;
      let content = hasInlineContent ? sourcesContent[index] : null;
      let loadedFrom = hasInlineContent ? 'sourcesContent' : null;

      if (content == null) {
        const fetchUrl = resolveFetchableUrl(sourceUrl, sourceMapUrl);

        if (fetchUrl) {
          try {
            content = await fetchText(fetchUrl);
            loadedFrom = 'fetch';
          } catch (err) {
            debug.sources.missing.push({
              sourceMapUrl,
              source,
              sourceUrl,
              saveAs: saveAs.path,
              fetchUrl,
              error: err.message,
            });
          }
        } else {
          debug.sources.missing.push({
            sourceMapUrl,
            source,
            sourceUrl,
            saveAs: saveAs.path,
            error: 'No inline content and no fetchable source URL',
          });
        }
      }

      if (content != null) {
        debug.sources.generated.push({
          sourceMapUrl,
          source,
          sourceUrl,
          saveAs: saveAs.path,
          loadedFrom,
          bytes: content.length,
        });

        resources.push({
          source: 'SOURCE_MAP',
          url: sourceUrl || `source-map://${saveAs.path}`,
          type: inferSourceMapSourceType(saveAs.path),
          content,
          encoding: null,
          saveAs,
          failed: false,
          skipBeautify: true,
          origin: {
            sourceMapUrl,
            sourceIndex: index,
            source,
            loadedFrom,
          },
        });
      }
    }
  }

  return resources;
};

export const createDebugResource = (debug) => ({
  source: 'DEBUG',
  url: DEBUG_FILE_PATH,
  type: 'application/json',
  content: JSON.stringify(debug, null, 2),
  encoding: null,
  saveAs: {
    path: DEBUG_FILE_PATH,
    name: 'debug.json',
    dataURI: false,
  },
  failed: false,
  skipBeautify: true,
});

export const expandSourceMapsForDownload = async ({ resources = [], debuggerResult, version, tabUrl, options }) => {
  const debug = {
    version,
    tabUrl,
    createdAt: new Date().toISOString(),
    options,
    input: {
      resourceCount: resources.length,
      urls: resources.map((resource) => resource.url),
    },
    debugger: debuggerResult || null,
    sourceMaps: {
      found: [],
      loaded: [],
      errors: [],
      rawSaved: [],
    },
    sources: {
      generated: [],
      missing: [],
    },
    sourceUrlOnlyScripts: [],
    finalZipPaths: [],
  };
  const resourceIndex = indexResourcesByUrl(resources);
  const candidates = await collectSourceMapCandidates(resources, debuggerResult, debug, resourceIndex);
  const expandedResources = [];

  console.log('[SOURCE MAP]', 'Candidates found:', candidates.length);

  for (let index = 0; index < candidates.length; index++) {
    const loadedSourceMap = await loadSourceMapCandidate(candidates[index], index, debug, resourceIndex);

    if (!loadedSourceMap?.content) {
      continue;
    }

    expandedResources.push({
      source: 'SOURCE_MAP',
      url: loadedSourceMap.url.startsWith('data:') ? `${candidates[index].scriptUrl || 'inline'}#sourceMappingURL` : loadedSourceMap.url,
      type: 'application/json',
      content: loadedSourceMap.content,
      encoding: null,
      saveAs: loadedSourceMap.saveAs,
      failed: false,
      skipBeautify: true,
      origin: {
        loadedFrom: loadedSourceMap.loadedFrom,
        scriptUrl: candidates[index].scriptUrl,
      },
    });
    debug.sourceMaps.rawSaved.push({
      sourceMapUrl: loadedSourceMap.url.startsWith('data:') ? `${candidates[index].scriptUrl || 'inline'}#sourceMappingURL` : loadedSourceMap.url,
      saveAs: loadedSourceMap.saveAs.path,
      loadedFrom: loadedSourceMap.loadedFrom,
    });

    const sourceMap = parseSourceMapText(loadedSourceMap.content);

    if (!sourceMap) {
      debug.sourceMaps.errors.push({
        sourceMapUrl: loadedSourceMap.url,
        error: 'Invalid source map JSON',
      });
      continue;
    }

    expandedResources.push(...(await sourceMapToResources(sourceMap, loadedSourceMap.url, debug)));
  }

  console.log('[SOURCE MAP]', 'Sources generated:', debug.sources.generated.length);
  console.log('[SOURCE MAP]', 'Sources missing:', debug.sources.missing.length);

  return {
    resources: expandedResources,
    debug,
  };
};
