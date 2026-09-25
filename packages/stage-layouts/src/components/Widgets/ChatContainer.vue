<template>
  <div
    :class="[
      'relative h-full w-full flex flex-col overflow-hidden rounded-xl',
      'airi-overlay-glass',
      'shadow-[0_18px_42px_rgba(15,23,42,0.08)] dark:shadow-[0_18px_42px_rgba(0,0,0,0.2)]',
    ]"
  >
    <slot />
  </div>
</template>
