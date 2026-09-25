<script setup lang="ts">
import { GamingMinecraft } from '@proj-airi/stage-ui/components'
import { Callout } from '@proj-airi/ui'

const instructionPanelClass = 'airi-surface-panel rounded-lg p-4'
const instructionTitleClass = 'airi-text mb-3 text-base font-semibold'
const instructionListClass = 'airi-text-muted list-decimal space-y-2 pl-4 text-sm'
const instructionStepTitleClass = 'font-medium text-[var(--airi-text)]'
const commandClass = [
  'mt-1 block rounded-md px-2 py-1',
  'border border-solid border-[var(--airi-border-subtle)]',
  'bg-[var(--airi-surface-field)] text-xs text-[var(--airi-text-muted)]',
]
const instructionNoteClass = 'airi-status-info mt-4 rounded p-3 text-xs'
const instructionNoteHintClass = 'mt-1 text-xs text-[var(--airi-text-soft)]'
</script>

<template>
  <div space-y-4>
    <!-- Warning Callout -->
    <Callout theme="orange">
      <template #label>
        <div flex items-center gap-1 font-normal>
          <div i-solar:danger-circle-bold-duotone text-lg />
          <div text-base>
            Integration Unavailable
          </div>
        </div>
      </template>
      <div text-base>
        Minecraft bot integration is currently broken and will be fixed in the near future.
      </div>
    </Callout>

    <!-- Instructions Section -->
    <div :class="instructionPanelClass">
      <h3 :class="instructionTitleClass">
        Experiment with the WIP Bot
      </h3>

      <ol :class="instructionListClass">
        <li>
          <div>
            <span :class="instructionStepTitleClass">Checkout the Project AIRI repository</span>
            <code :class="commandClass">git clone https://github.com/moeru-ai/airi</code>
          </div>
        </li>
        <li>
          <div>
            <span :class="instructionStepTitleClass">Navigate to services/minecraft</span>
            <code :class="commandClass">cd services/minecraft</code>
          </div>
        </li>
        <li>
          <div>
            <span :class="instructionStepTitleClass">Install dependencies</span>
            <code :class="commandClass">pnpm install</code>
          </div>
        </li>
        <li>
          <div>
            <span :class="instructionStepTitleClass">Setup environment</span>
            <code :class="commandClass">cp .env .env.local</code>
            <div :class="instructionNoteHintClass">
              Fill in the required values in .env.local
            </div>
          </div>
        </li>
        <li>
          <div>
            <span :class="instructionStepTitleClass">Run the bot</span>
            <code :class="commandClass">pnpm dev</code>
          </div>
        </li>
      </ol>

      <div :class="instructionNoteClass">
        <div flex items-start gap-2>
          <div i-solar:info-circle-bold-duotone mt-0.5 flex-shrink-0 />
          <div>
            <strong>Please note:</strong> The bot is still in development and may not work as expected. We're actively working on improving it.
          </div>
        </div>
      </div>
    </div>
    <GamingMinecraft />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.gaming-minecraft.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
