// The engines pack: static checks for game engine projects (Unity, Godot, Unreal) and storefront or CMS projects (Shopify, Liquid, WordPress, static site generators).
// Each check says "not applicable" when the project is not of its kind. Turn it on with { "packs": ["engines"] } in meerkat.config.json.
import { MEERKAT_DIR as MK } from '../../lib/paths.mjs'

const ES = `${MK}/thorough/engines.mjs`
const make = (id, group, title) => ({
  id,
  group,
  tier: 'fast',
  lane: 'free',
  weight: 'tiny',
  suite: 'config-files',
  title,
  estSeconds: 1,
  needs: ['node'],
  run: { cmd: 'node', args: [ES, id], cwd: 'repo' },
  selfTest: { cmd: 'node', args: [ES, id, '--fixtures'], cwd: 'repo', expectFail: true },
})

export default [
  make('unity-meta-files', 'functionality', 'Unity: every asset has a .meta file, every .meta has an asset, no GUID repeats'),
  make('unity-gitignore', 'functionality', 'Unity: Library, Temp, Logs, obj and UserSettings are ignored and not tracked'),
  make('unity-serialization', 'functionality', 'Unity: assets are saved as text (Force Text), not binary'),
  make('unity-large-assets', 'functionality', 'Unity: textures, audio and models over the size budget are in Git LFS'),
  make('unity-script-hazards', 'functionality', 'Unity: Update() does not call Find, GetComponent, Resources.Load or Debug.Log'),
  make('godot-project', 'functionality', 'Godot: project.godot has a config_version, build output is ignored, presets hold no credentials'),
  make('godot-script-hazards', 'functionality', 'Godot: _process() does not call print() or get_node()'),
  make('unreal-hygiene', 'functionality', 'Unreal: .uproject is valid, generated folders are ignored, assets and plugin versions are in order'),
  make('shopify-theme-basics', 'functionality', 'Shopify theme: settings schema valid, templates and assets resolve, no store URL next to a token'),
  make('liquid-hygiene', 'functionality', 'Liquid: blocks are closed, render not include, images have alt, scripts defer or async'),
  make('shopify-secrets', 'security', 'Shopify: no Admin, custom app, private app or storefront token in a tracked file'),
  make('wordpress-hygiene', 'functionality', 'WordPress: ABSPATH guard, sanitised input, no eval or base64_decode, prepared queries'),
  make('wordpress-config', 'functionality', 'WordPress: wp-config.php holds no committed credentials, live salts or WP_DEBUG'),
  make('static-site-generator', 'functionality', 'Static site: https site URL, no published drafts (a 404 page is noted)'),
]
