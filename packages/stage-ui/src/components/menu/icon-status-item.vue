<script setup lang="ts">
const props = defineProps<{
  title: string
  description?: string
  icon?: string
  iconColor?: string
  iconImage?: string
  to: string
  configured?: boolean
}>()
</script>

<template>
  <div
    :class="[
      'airi-card airi-card-hover menu-icon-status-item',
      'w-full flex flex-col cursor-pointer overflow-hidden rounded-lg',
      'transition-all duration-300 ease-out',
    ]"
  >
    <RouterLink
      :to="props.to"
      :class="[
        'menu-icon-status-item-link',
        'relative h-full w-full flex flex-row items-center overflow-hidden rounded-lg p-5 text-left',
        'transition-all duration-300 ease-out',
      ]"
    >
      <div class="z-1 flex-1">
        <div
          :class="[
            'airi-text menu-icon-status-item-title',
            'text-lg font-normal transition-all duration-300 ease-out',
          ]"
        >
          {{ props.title }}
        </div>
        <div
          :class="[
            'airi-text-muted menu-icon-status-item-description',
            'text-sm transition-all duration-300 ease-out',
          ]"
        >
          <span>{{ props.description || '' }}</span>
        </div>
      </div>
      <template v-if="props.icon">
        <div
          :class="[
            props.icon,
            'menu-icon-status-item-icon',
            'absolute right-0 size-16 translate-y-2 grayscale-100',
            'airi-text-muted opacity-50',
            'transition-all duration-300 ease-out',
          ]"
        />
      </template>
      <template v-if="props.iconColor">
        <div
          :class="[
            props.iconColor,
            'menu-icon-status-item-icon-color',
            'absolute right-0 size-16 translate-y-2 grayscale-100',
            'airi-text-muted opacity-50',
            'transition-all duration-300 ease-out',
          ]"
        />
      </template>
      <template v-if="props.iconImage">
        <img
          :src="props.iconImage"
          :class="[
            'menu-icon-status-item-icon-image',
            'absolute right-0 size-16 translate-y-2 grayscale-100',
            'transition-all duration-300 ease-out',
          ]"
        >
      </template>
    </RouterLink>
    <div class="p-2">
      <div
        v-if="props.configured"
        class="size-4 rounded-full bg-emerald-500 shadow-emerald-500/30 shadow-lg"
      />
      <div
        v-else
        class="size-4 airi-control-muted rounded-full p-0"
      />
    </div>
  </div>
</template>

<style scoped>
.menu-icon-status-item {
  position: relative;
  overflow: hidden;
}

.menu-icon-status-item::before {
  background: linear-gradient(90deg, transparent, transparent);
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 25%;
  height: 100%;
  transition: all 0.4s ease-in-out;
  mask-image: linear-gradient(120deg, white 100%);
  opacity: 0;
}

.menu-icon-status-item:hover::before,
.menu-icon-status-item._hover::before {
  background: linear-gradient(90deg, var(--airi-accent-surface), transparent);
  width: 50%;
  opacity: 1;
}

.menu-icon-status-item-link::after {
  position: absolute;
  inset: 0;
  z-index: -2;
  width: 100%;
  height: 100%;
  background-image: radial-gradient(var(--airi-border-subtle) 1px, transparent 1px);
  background-size: 10px 10px;
  content: '';
  mask-image: linear-gradient(165deg, white 30%, transparent 50%);
  transition: all 0.4s ease-in-out;
}

.menu-icon-status-item:hover .menu-icon-status-item-link::after,
.menu-icon-status-item._hover .menu-icon-status-item-link::after {
  background-image: radial-gradient(var(--airi-border-accent) 1px, transparent 1px);
}

.menu-icon-status-item-icon-color {
  opacity: 0.5;
}

.menu-icon-status-item:hover .menu-icon-status-item-title,
.menu-icon-status-item._hover .menu-icon-status-item-title {
  color: var(--airi-accent-text);
}

.menu-icon-status-item:hover .menu-icon-status-item-description,
.menu-icon-status-item._hover .menu-icon-status-item-description {
  color: var(--airi-accent-text);
  opacity: 0.8;
}

.menu-icon-status-item:hover .menu-icon-status-item-icon,
.menu-icon-status-item._hover .menu-icon-status-item-icon,
.menu-icon-status-item:hover .menu-icon-status-item-icon-color,
.menu-icon-status-item._hover .menu-icon-status-item-icon-color {
  color: var(--airi-accent-strong);
  scale: 1.2;
}
</style>
