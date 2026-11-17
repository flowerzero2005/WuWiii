<script setup lang="ts">
import type { NotebookEntry } from '@proj-airi/stage-ui/stores/character/notebook'

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ entries: NotebookEntry[] }>()
const { locale } = useI18n()
const canvas = ref<HTMLCanvasElement>()
const scene = ref<HTMLElement>()
const selectedId = ref<string>()
const activeKind = ref<string>()
const spinning = ref(true)
const zoom = ref(1)

const kinds = [
  { key: 'identity', zh: '身份', en: 'Identity', color: '#8bd4ff' },
  { key: 'relationship', zh: '关系', en: 'Relationship', color: '#f8a6d9' },
  { key: 'preference', zh: '喜好', en: 'Preferences', color: '#fbc88a' },
  { key: 'event', zh: '经历', en: 'Events', color: '#9ce1c6' },
  { key: 'plan', zh: '计划', en: 'Plans', color: '#b6a8ff' },
  { key: 'communication', zh: '表达', en: 'Communication', color: '#f3a6a1' },
  { key: 'boundary', zh: '边界', en: 'Boundaries', color: '#f5dc8f' },
  { key: 'other', zh: '其他', en: 'Other', color: '#b9c9e8' },
] as const

function kindOf(entry: NotebookEntry) {
  const value = entry.metadata?.memoryType
  if (typeof value === 'string' && kinds.some(kind => kind.key === value))
    return value
  if (entry.kind === 'focus')
    return 'plan'
  if (entry.kind === 'diary')
    return 'event'
  return 'other'
}

function label(zh: string, en: string) {
  return locale.value.startsWith('zh') ? zh : en
}

const totals = computed(() => kinds.map(kind => ({
  ...kind,
  count: props.entries.filter(entry => kindOf(entry) === kind.key).length,
  recent: props.entries.filter(entry => kindOf(entry) === kind.key && entry.createdAt >= Date.now() - 30 * 86400_000).length,
})))
const selected = computed(() => props.entries.find(entry => entry.id === selectedId.value))
const visibleEntries = computed(() => {
  const entries = activeKind.value ? props.entries.filter(entry => kindOf(entry) === activeKind.value) : props.entries
  return [...entries].sort((a, b) => b.createdAt - a.createdAt).slice(0, 180)
})

const links = computed(() => {
  const latestByTag = new Map<string, string>()
  const latestBySession = new Map<string, string>()
  const result: Array<{ from: string, to: string, reason: 'tag' | 'session' }> = []
  for (const entry of visibleEntries.value) {
    let connected = 0
    for (const rawTag of entry.tags ?? []) {
      const tag = rawTag.trim().toLocaleLowerCase()
      if (!tag || tag === 'character-diary')
        continue
      const previous = latestByTag.get(tag)
      if (previous && previous !== entry.id && connected < 2 && !result.some(link => link.from === entry.id && link.to === previous)) {
        result.push({ from: entry.id, to: previous, reason: 'tag' })
        connected++
      }
      latestByTag.set(tag, entry.id)
    }
    const session = entry.metadata?.sourceSessionId
    if (typeof session === 'string' && session) {
      const previous = latestBySession.get(session)
      if (previous && previous !== entry.id && connected < 2 && !result.some(link => link.from === entry.id && link.to === previous))
        result.push({ from: entry.id, to: previous, reason: 'session' })
      latestBySession.set(session, entry.id)
    }
  }
  return result
})
const relatedEntries = computed(() => selectedId.value
  ? links.value.filter(link => link.from === selectedId.value || link.to === selectedId.value)
      .map(link => props.entries.find(entry => entry.id === (link.from === selectedId.value ? link.to : link.from)))
      .filter((entry): entry is NotebookEntry => !!entry)
  : [])

function hash(value: string) {
  let result = 2166136261
  for (let i = 0; i < value.length; i++)
    result = Math.imul(result ^ value.charCodeAt(i), 16777619)
  return (result >>> 0) / 4294967295
}

interface Point { id: string, x: number, y: number, size: number }
let points: Point[] = []
let frame = 0
let width = 0
let height = 0
let yaw = -0.35
let tilt = -0.17
let lastTime = 0
let reducedMotion = false
let inView = true
let observer: ResizeObserver | undefined
let visibilityObserver: IntersectionObserver | undefined
let motionQuery: MediaQueryList | undefined
let pointer: { id: number, x: number, y: number, distance: number } | undefined
function onMotionChange(event: MediaQueryListEvent) {
  reducedMotion = event.matches
}

function resize() {
  if (!scene.value || !canvas.value)
    return
  const rect = scene.value.getBoundingClientRect()
  width = rect.width
  height = rect.height
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  canvas.value.width = Math.round(width * ratio)
  canvas.value.height = Math.round(height * ratio)
  canvas.value.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0)
  draw(performance.now())
}

function draw(time: number) {
  const context = canvas.value?.getContext('2d')
  if (!context || !width || !height)
    return
  context.clearRect(0, 0, width, height)
  const cx = width / 2
  const cy = height / 2 + 9
  const radius = Math.min(width * 0.42, height * 0.43) * zoom.value

  // Fixed background stars keep the field stable while the memory constellation turns.
  for (let i = 0; i < 80; i++) {
    const x = hash(`${i * 7919}:background-x`) * width
    const y = hash(`${i * 104729}:background-y`) * height
    const pulse = reducedMotion ? 1 : 0.68 + Math.sin(time / 900 + i * 2.7) * 0.26
    context.fillStyle = `rgba(215,231,255,${pulse * (0.14 + hash(`background-a-${i}`) * 0.35)})`
    context.beginPath()
    context.arc(x, y, i % 11 === 0 ? 1.15 : 0.65, 0, Math.PI * 2)
    context.fill()
  }

  context.save()
  context.translate(cx, cy)
  context.rotate(-0.24)
  for (const [index, scale] of [0.52, 0.79, 1.05].entries()) {
    context.beginPath()
    context.ellipse(0, 0, radius * scale, radius * scale * 0.50, 0, 0, Math.PI * 2)
    context.strokeStyle = `rgba(150,192,246,${0.12 - index * 0.022})`
    context.lineWidth = 1
    context.stroke()
  }
  for (let index = 0; index < 3; index++) {
    const scale = [0.52, 0.79, 1.05][index]!
    const angle = reducedMotion ? 0.8 + index * 1.7 : time * (0.00015 + index * 0.000025) + index * 1.7
    const trail = context.createLinearGradient(-radius, -radius / 2, radius, radius / 2)
    trail.addColorStop(0, 'rgba(111,221,255,0)')
    trail.addColorStop(0.55, 'rgba(143,194,255,.2)')
    trail.addColorStop(1, 'rgba(196,158,255,.7)')
    context.beginPath()
    context.ellipse(0, 0, radius * scale, radius * scale * 0.50, 0, angle, angle + 0.40)
    context.strokeStyle = trail
    context.lineWidth = index === 1 ? 2.2 : 1.5
    context.shadowColor = index === 1 ? '#88d9ff' : '#bf9cff'
    context.shadowBlur = 13
    context.stroke()
  }
  context.shadowBlur = 0
  context.restore()

  const aura = context.createRadialGradient(cx, cy, 2, cx, cy, radius * 0.52)
  aura.addColorStop(0, 'rgba(168,207,255,.30)')
  aura.addColorStop(0.30, 'rgba(127,117,235,.12)')
  aura.addColorStop(1, 'rgba(91,107,200,0)')
  context.fillStyle = aura
  context.beginPath()
  context.arc(cx, cy, radius * 0.52, 0, Math.PI * 2)
  context.fill()

  const projected = visibleEntries.value.map((entry) => {
    const kind = kindOf(entry)
    const index = kinds.findIndex(item => item.key === kind)
    const angle = (index / kinds.length) * Math.PI * 2 + (hash(`${entry.id}:angle`) - 0.5) * 0.7
    const spread = 0.51 + hash(`${entry.id}:radius`) * 0.43
    const x = Math.cos(angle) * spread
    const z = Math.sin(angle) * spread
    const y = (hash(`${entry.id}:height`) - 0.5) * 1.15
    const turnedX = x * Math.cos(yaw) - z * Math.sin(yaw)
    const depth = x * Math.sin(yaw) + z * Math.cos(yaw)
    const size = (entry.metadata?.importance === 'high' ? 3.9 : entry.metadata?.importance === 'medium' ? 3.1 : 2.4) * (0.82 + depth * 0.28)
    return { entry, kind, depth, x: cx + turnedX * radius, y: cy + (y * Math.cos(tilt) + depth * Math.sin(tilt)) * radius * 0.77, size }
  }).sort((a, b) => a.depth - b.depth)

  const byId = new Map(projected.map(star => [star.entry.id, star]))
  const hubs = totals.value.filter(kind => kind.count > 0 && (!activeKind.value || activeKind.value === kind.key)).map((kind) => {
    const index = kinds.findIndex(item => item.key === kind.key)
    const angle = (index / kinds.length) * Math.PI * 2
    const x = Math.cos(angle) * 0.58
    const z = Math.sin(angle) * 0.58
    const depth = x * Math.sin(yaw) + z * Math.cos(yaw)
    return { ...kind, x: cx + (x * Math.cos(yaw) - z * Math.sin(yaw)) * radius, y: cy + depth * Math.sin(tilt) * radius * 0.77 }
  })
  for (const hub of hubs) {
    const members = projected.filter(star => star.kind === hub.key)
    for (const star of members) {
      context.beginPath()
      context.moveTo(hub.x, hub.y)
      context.lineTo(star.x, star.y)
      context.strokeStyle = selectedId.value === star.entry.id ? `${hub.color}a0` : `${hub.color}35`
      context.lineWidth = selectedId.value === star.entry.id ? 1.5 : 0.7
      context.stroke()
    }
  }
  for (const [index, link] of links.value.entries()) {
    const from = byId.get(link.from)
    const to = byId.get(link.to)
    if (!from || !to)
      continue
    const highlighted = selectedId.value === link.from || selectedId.value === link.to
    context.beginPath()
    context.moveTo(from.x, from.y)
    context.lineTo(to.x, to.y)
    context.strokeStyle = highlighted ? 'rgba(240,248,255,.82)' : link.reason === 'tag' ? 'rgba(148,224,255,.32)' : 'rgba(210,173,255,.20)'
    context.lineWidth = highlighted ? 1.6 : 0.85
    context.stroke()
    if ((highlighted || index % 5 === 0) && !reducedMotion) {
      const progress = (time * 0.00022 + hash(link.from + link.to)) % 1
      context.fillStyle = highlighted ? '#ffffff' : '#a8dfff'
      context.shadowColor = context.fillStyle
      context.shadowBlur = 12
      context.beginPath()
      context.arc(from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress, highlighted ? 2 : 1.3, 0, Math.PI * 2)
      context.fill()
      context.shadowBlur = 0
    }
  }
  for (const hub of hubs) {
    const selected = activeKind.value === hub.key
    context.fillStyle = hub.color
    context.shadowColor = hub.color
    context.shadowBlur = selected ? 28 : 18
    context.beginPath()
    context.arc(hub.x, hub.y, selected ? 5.5 : 4, 0, Math.PI * 2)
    context.fill()
    context.shadowBlur = 0
    context.font = '600 10px sans-serif'
    context.textAlign = 'center'
    context.fillStyle = '#eaf1ff'
    context.fillText(label(hub.zh, hub.en), hub.x, hub.y - 13)
  }
  points = []
  for (const star of projected) {
    const color = kinds.find(kind => kind.key === star.kind)?.color ?? '#b9c9e8'
    const isSelected = selectedId.value === star.entry.id
    const isRecent = star.entry.createdAt >= Date.now() - 7 * 86400_000
    context.shadowBlur = isSelected ? 28 : isRecent ? 17 : 10
    context.shadowColor = color
    context.fillStyle = color
    context.beginPath()
    context.arc(star.x, star.y, isSelected ? star.size + 2 : star.size, 0, Math.PI * 2)
    context.fill()
    context.shadowBlur = 0
    if (isSelected || isRecent) {
      context.strokeStyle = isSelected ? 'rgba(255,255,255,.9)' : `${color}70`
      context.lineWidth = 1
      context.beginPath()
      context.arc(star.x, star.y, star.size + (isSelected ? 8 : 4), 0, Math.PI * 2)
      context.stroke()
    }
    points.push({ id: star.entry.id, x: star.x, y: star.y, size: star.size })
  }

  context.shadowBlur = 24
  context.shadowColor = '#9abfff'
  context.fillStyle = '#f5f7ff'
  context.beginPath()
  context.arc(cx, cy, 5, 0, Math.PI * 2)
  context.fill()
  context.shadowBlur = 0
}

function animate(time: number) {
  if (inView) {
    if (spinning.value && !reducedMotion && !pointer && lastTime)
      yaw += Math.min(time - lastTime, 64) * 0.00011
    draw(time)
  }
  lastTime = time
  frame = requestAnimationFrame(animate)
}

function pointerDown(event: PointerEvent) {
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0 }
  canvas.value?.setPointerCapture(event.pointerId)
}

function pointerMove(event: PointerEvent) {
  if (!pointer || pointer.id !== event.pointerId)
    return
  const dx = event.clientX - pointer.x
  const dy = event.clientY - pointer.y
  pointer.distance += Math.abs(dx) + Math.abs(dy)
  yaw += dx * 0.008
  tilt = Math.max(-0.65, Math.min(0.65, tilt + dy * 0.003))
  pointer.x = event.clientX
  pointer.y = event.clientY
  draw(performance.now())
}

function pointerUp(event: PointerEvent) {
  if (!pointer || pointer.id !== event.pointerId)
    return
  if (pointer.distance < 7 && canvas.value) {
    const rect = canvas.value.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const nearest = points.map(point => ({ point, distance: Math.hypot(point.x - x, point.y - y) })).sort((a, b) => a.distance - b.distance)[0]
    if (nearest && nearest.distance < Math.max(17, nearest.point.size + 12))
      selectedId.value = nearest.point.id
  }
  pointer = undefined
}

function setZoom(value: number) {
  zoom.value = Math.max(0.65, Math.min(2.4, Math.round(value * 100) / 100))
  draw(performance.now())
}

function wheelZoom(event: WheelEvent) {
  setZoom(zoom.value * (event.deltaY < 0 ? 1.12 : 1 / 1.12))
}

function resetView() {
  yaw = -0.35
  tilt = -0.17
  setZoom(1)
}

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion = motionQuery.matches
  motionQuery.addEventListener('change', onMotionChange)
  observer = new ResizeObserver(resize)
  if (scene.value)
    observer.observe(scene.value)
  visibilityObserver = new IntersectionObserver(([entry]) => {
    inView = !!entry?.isIntersecting
  })
  if (scene.value)
    visibilityObserver.observe(scene.value)
  resize()
  frame = requestAnimationFrame(animate)
})
onUnmounted(() => {
  cancelAnimationFrame(frame)
  observer?.disconnect()
  visibilityObserver?.disconnect()
  motionQuery?.removeEventListener('change', onMotionChange)
})
watch(visibleEntries, () => {
  if (selectedId.value && !props.entries.some(entry => entry.id === selectedId.value))
    selectedId.value = undefined
  draw(performance.now())
})
</script>

<template>
  <section class="memory-atlas" :aria-label="label('记忆星图', 'Memory atlas')">
    <div class="atlas-heading">
      <div>
        <p class="atlas-kicker">MEMORY ATLAS / {{ label('持续生长', 'GROWING TOGETHER') }}</p>
        <h3>{{ label('记忆星图', 'Memory atlas') }}</h3>
        <p class="atlas-subtitle">{{ label('拖动旋转，点亮记忆。连线表示共同标签或同一段对话。', 'Drag to rotate. Links mark a shared tag or conversation.') }}</p>
      </div>
      <button type="button" class="atlas-motion" :aria-pressed="spinning" @click="spinning = !spinning">
        <span :class="spinning ? 'i-solar:pause-bold' : 'i-solar:play-bold'" aria-hidden="true" />
        {{ spinning ? label('暂停旋转', 'Pause orbit') : label('继续旋转', 'Resume orbit') }}
      </button>
    </div>
    <div class="atlas-body">
      <div ref="scene" class="atlas-scene">
        <canvas ref="canvas" class="atlas-canvas" :aria-label="label('可拖动和缩放的记忆星图', 'Draggable and zoomable memory atlas')" @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp" @wheel.prevent="wheelZoom" />
        <div class="atlas-zoom" :aria-label="label('星图缩放', 'Atlas zoom')">
          <button type="button" :aria-label="label('缩小星图', 'Zoom out')" :disabled="zoom <= 0.65" @click="setZoom(zoom / 1.2)">−</button>
          <span>{{ Math.round(zoom * 100) }}%</span>
          <button type="button" :aria-label="label('放大星图', 'Zoom in')" :disabled="zoom >= 2.4" @click="setZoom(zoom * 1.2)">+</button>
          <button type="button" :aria-label="label('重置星图视角', 'Reset atlas view')" @click="resetView">{{ label('重置', 'Reset') }}</button>
        </div>
        <div v-if="links.length" class="atlas-legend" aria-hidden="true"><span class="atlas-legend-tag" />{{ label('共同标签', 'Shared tag') }}<span class="atlas-legend-session" />{{ label('同一对话', 'Same conversation') }}</div>
        <div class="atlas-core-label" aria-hidden="true"><span>{{ entries.length }}</span><small>{{ label('条记忆', 'MEMORIES') }}</small></div>
        <p v-if="!entries.length" class="atlas-empty">{{ label('新的记忆会在这里亮起', 'New memories will light up here') }}</p>
      </div>
      <div class="atlas-side">
        <div class="atlas-growth"><span>{{ label('近 30 天新增', 'ADDED IN 30 DAYS') }}</span><strong>+{{ entries.filter(entry => entry.createdAt >= Date.now() - 30 * 86400_000).length }}</strong></div>
        <div class="atlas-kinds">
          <button v-for="kind in totals" :key="kind.key" type="button" class="atlas-kind" :class="{ 'is-active': activeKind === kind.key }" :aria-pressed="activeKind === kind.key" @click="activeKind = activeKind === kind.key ? undefined : kind.key">
            <span class="atlas-kind-dot" :style="{ backgroundColor: kind.color, boxShadow: `0 0 12px ${kind.color}` }" />
            <span>{{ label(kind.zh, kind.en) }}</span>
            <strong>{{ kind.count }}</strong>
            <small v-if="kind.recent">+{{ kind.recent }}</small>
          </button>
        </div>
        <div class="atlas-detail">
          <template v-if="selected">
            <p>{{ label('已选记忆', 'SELECTED MEMORY') }} · {{ new Date(selected.createdAt).toLocaleDateString(locale) }}</p>
            <strong>{{ selected.text }}</strong>
            <div v-if="selected.tags?.length" class="atlas-tags"><span v-for="tag in selected.tags" :key="tag">#{{ tag }}</span></div>
            <div v-if="relatedEntries.length" class="atlas-related">
              <p>{{ label('关联记忆', 'RELATED MEMORIES') }} · {{ relatedEntries.length }}</p>
              <button v-for="entry in relatedEntries.slice(0, 5)" :key="entry.id" type="button" @click="selectedId = entry.id">{{ entry.text }}</button>
            </div>
          </template>
          <template v-else><p>{{ label('探索提示', 'EXPLORE') }}</p><strong>{{ label('选择星点查看记忆；选择主题查看它的星群。', 'Select a star to read it, or choose a theme to explore its cluster.') }}</strong></template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.memory-atlas { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; overflow: hidden; border: 1px solid #59668b77; border-radius: 22px; color: #f1f4ff; background: radial-gradient(circle at 36% 46%, #263663 0, #172441 28%, #0c152b 63%, #090f20 100%); box-shadow: inset 0 1px #c6d5ff20, 0 15px 45px #08132a25; }
.atlas-heading { display: flex; align-items: start; justify-content: space-between; gap: 16px; padding: 22px 24px 2px; }
.atlas-kicker { margin: 0 0 7px; color: #9caed2; font-size: 10px; font-weight: 700; letter-spacing: .22em; }
.atlas-heading h3 { margin: 0; font-size: clamp(22px, 3vw, 30px); font-weight: 650; letter-spacing: -.04em; }
.atlas-subtitle { margin: 7px 0 0; color: #b7c4df; font-size: 12px; }
.atlas-motion { display: flex; align-items: center; gap: 6px; flex: none; border: 1px solid #a7b9ea46; border-radius: 999px; padding: 8px 11px; color: #dbe5ff; background: #bed0ff11; font-size: 11px; }
.atlas-motion:focus-visible, .atlas-kind:focus-visible { outline: 2px solid #b7caff; outline-offset: 2px; }
.atlas-body { display: grid; min-width: 0; grid-template-columns: minmax(0, 1fr) 250px; align-items: stretch; gap: 4px; padding: 0 20px 18px 4px; }
.atlas-scene { position: relative; min-width: 0; height: 390px; overflow: hidden; }
.atlas-canvas { display: block; width: 100%; height: 100%; cursor: grab; touch-action: none; }
.atlas-canvas:active { cursor: grabbing; }
.atlas-zoom { position: absolute; z-index: 1; top: 10px; right: 10px; display: flex; align-items: center; gap: 3px; border: 1px solid #a7b9ea46; border-radius: 9px; padding: 3px; color: #eaf1ff; background: #0a1430d9; font-size: 11px; }
.atlas-zoom button { min-width: 25px; min-height: 25px; border-radius: 6px; padding: 0 5px; }
.atlas-zoom button:hover { background: #a8bdff36; }
.atlas-zoom button:disabled { opacity: .4; }
.atlas-zoom span { min-width: 38px; text-align: center; }
.atlas-legend { position: absolute; bottom: 8px; left: 15px; display: flex; align-items: center; gap: 6px; color: #c5d5f2; font-size: 9px; pointer-events: none; text-shadow: 0 1px 7px #0b1631; }
.atlas-legend-tag, .atlas-legend-session { width: 14px; height: 1px; margin-left: 5px; background: #94e0ff; box-shadow: 0 0 6px #94e0ff; }
.atlas-legend-session { background: #d2adff; box-shadow: 0 0 6px #d2adff; }
.atlas-core-label { position: absolute; top: 50%; left: 50%; display: flex; transform: translate(-50%, -45%); flex-direction: column; align-items: center; pointer-events: none; text-shadow: 0 2px 18px #0d204e; }
.atlas-core-label span { font-size: 25px; font-weight: 700; line-height: 1; }
.atlas-core-label small { margin-top: 5px; color: #b4c7eb; font-size: 8px; font-weight: 700; letter-spacing: .14em; }
.atlas-empty { position: absolute; bottom: 28px; left: 0; width: 100%; color: #b4c7eb; font-size: 12px; text-align: center; pointer-events: none; }
.atlas-side { display: flex; min-width: 0; flex-direction: column; gap: 13px; padding-top: 15px; }
.atlas-growth { display: flex; align-items: baseline; justify-content: space-between; padding: 0 2px 5px; border-bottom: 1px solid #9eafd135; }
.atlas-growth span { min-width: 0; color: #9fb1d6; font-size: 10px; font-weight: 700; letter-spacing: .09em; }
.atlas-growth strong { color: #b8e1ff; font-size: 21px; }
.atlas-kinds { display: grid; min-width: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.atlas-kind { display: flex; align-items: center; gap: 6px; min-width: 0; border: 1px solid #a8bbef25; border-radius: 10px; padding: 8px; color: #d6e0f7; background: #c1d0fc0a; font-size: 11px; text-align: left; transition: background .18s, border-color .18s; }
.atlas-kind:hover, .atlas-kind.is-active { border-color: #b9cfff77; background: #a8bdff21; }
.atlas-kind-dot { width: 6px; height: 6px; flex: none; border-radius: 50%; }
.atlas-kind span:nth-child(2) { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.atlas-kind strong { color: #fff; }
.atlas-kind small { color: #a6e4ca; }
.atlas-detail { min-width: 0; min-height: 91px; max-height: 230px; overflow-y: auto; margin-top: auto; border: 1px solid #aec3fa29; border-radius: 13px; padding: 12px; background: linear-gradient(135deg, #849aff19, #eaa9e70a); }
.atlas-detail p { margin: 0 0 7px; color: #a9bcdf; font-size: 10px; font-weight: 700; letter-spacing: .1em; }
.atlas-detail strong { display: block; color: #edf2ff; font-size: 12px; font-weight: 450; line-height: 1.55; overflow-wrap: anywhere; white-space: pre-wrap; }
.atlas-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; color: #a8cafd; font-size: 10px; overflow-wrap: anywhere; }
.atlas-tags span { max-width: 100%; }
.atlas-related { margin-top: 12px; border-top: 1px solid #aec3fa29; padding-top: 9px; }
.atlas-related button { display: block; width: 100%; overflow: hidden; border-radius: 5px; padding: 3px 0; color: #b9d7ff; font-size: 11px; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.atlas-related button:hover { color: #fff; text-decoration: underline; }
@media (max-width: 720px) { .atlas-heading { flex-wrap: wrap; padding: 18px 18px 0; } .atlas-body { grid-template-columns: minmax(0, 1fr); gap: 0; padding: 0 16px 16px; } .atlas-scene { height: min(78vw, 360px); min-height: 260px; } .atlas-side { padding-top: 0; } .atlas-kinds { grid-template-columns: repeat(4, minmax(0, 1fr)); } .atlas-kind { justify-content: center; padding: 7px 3px; } .atlas-kind small { display: none; } .atlas-detail { min-height: 70px; } }
@media (max-width: 390px) { .atlas-kinds { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (prefers-reduced-motion: reduce) { .atlas-kind { transition: none; } }
</style>
