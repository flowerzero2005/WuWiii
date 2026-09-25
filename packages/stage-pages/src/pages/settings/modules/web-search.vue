<script setup lang="ts">
import { Alert, RadioCardSimple } from '@proj-airi/stage-ui/components'
import { useWebSearchStore } from '@proj-airi/stage-ui/stores/modules/web-search'
import { useOfficialPricingStore } from '@proj-airi/stage-ui/stores/official-pricing'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { Button, FieldCheckbox, FieldRange } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const providersStore = useProvidersStore()
const { t } = useI18n()
const officialPricingStore = useOfficialPricingStore()
officialPricingStore.start()
onUnmounted(() => officialPricingStore.stop())
const officialWebSearchPoints = computed(() => officialPricingStore.getCapability('webSearch')?.pointsPerRequest)
void providersStore.startRuntimeValidation()
const webSearchStore = useWebSearchStore()
const { persistedWebSearchProvidersMetadata, configuredProviders } = storeToRefs(providersStore)
const {
  enabled,
  activeProvider,
  characterProfileEnabled,
  configured,
  apiKeyValid,
  apiKeyValidating,
  apiKeyError,
  // Interest weights
  interestAnime,
  interestMemes,
  interestGames,
  interestTechnology,
  interestArt,
  interestMusic,
  interestFood,
  interestFashion,
  interestScience,
  interestPhilosophy,
  interestSports,
  interestNews,
  // Depth preferences
  depthSuperficial,
  depthModerate,
  depthDeep,
  // Expression style
  styleCute,
  stylePlayful,
  styleSerious,
  styleCasual,
  styleProfessional,
  styleEmotional,
  // Behavior preferences
  knowledgeTransparency,
  pretendUncertainty,
} = storeToRefs(webSearchStore)

// Check if API key is missing
const apiKeyMissing = computed(() => enabled.value && !configured.value)

watch(activeProvider, () => {
  webSearchStore.clearValidation()
})

async function testApiKey() {
  await webSearchStore.validateApiKey()
}

function handleDeleteProvider(providerId: string) {
  if (activeProvider.value === providerId)
    activeProvider.value = ''

  providersStore.deleteProvider(providerId)
}

const settingsPanelClass = [
  'airi-surface-panel rounded-xl p-4',
  'flex flex-col gap-6',
]
const sectionTitleClass = 'airi-text text-lg font-semibold md:text-2xl'
const sectionDescriptionClass = 'airi-text-muted'
const iconButtonClass = 'airi-overlay-control-muted rounded p-1'
const addProviderCardClass = [
  'settings-provider-card-item airi-card airi-card-hover relative rounded-xl p-4',
  'flex flex-col items-center justify-center',
  'transition-all duration-200 ease-in-out',
]
const addProviderIconClass = 'i-solar:add-circle-line-duotone text-2xl text-[var(--airi-text-muted)]'
const emptyProviderLinkClass = [
  'airi-card airi-card-hover rounded-lg p-4',
  'flex items-center gap-3',
  'transition-colors duration-200 ease-in-out',
]
const emptyProviderDescriptionClass = 'text-sm text-[var(--airi-text-muted)]'
const emptyProviderArrowClass = 'i-solar:arrow-right-line-duotone ml-auto text-xl text-[var(--airi-text-muted)]'
const subsectionTitleClass = 'airi-text mb-4 text-base font-semibold md:text-lg'
const subsectionDescriptionClass = 'airi-text-muted mb-4 text-sm'
</script>

<template>
  <div flex="~ col gap-6">
    <div :class="settingsPanelClass">
      <!-- Main Settings -->
      <div>
        <h2 :class="sectionTitleClass">
          智能联网系统
        </h2>
        <div :class="sectionDescriptionClass">
          <span>配置智能联网行为和核心结果的人设个性化</span>
        </div>
      </div>
      <p :class="['text-xs airi-text-muted']">
        {{ officialWebSearchPoints === undefined
          ? t('settings.pages.modules.web-search.pricing.loading')
          : t('settings.pages.modules.web-search.pricing.official', { points: officialWebSearchPoints }) }}
      </p>

      <!-- Enable/Disable -->
      <div flex="~ col gap-4">
        <FieldCheckbox
          v-model="enabled"
          label="启用智能联网"
          description="允许 AI 在需要时联网查询信息"
        />

        <Alert
          v-if="apiKeyMissing"
          type="warning"
        >
          <template #title>
            需要配置联网搜索服务来源
          </template>
          <template #content>
            智能联网功能需要先在服务来源页面配置 Tavily，然后在这里选择它。
          </template>
        </Alert>

        <div v-if="enabled" flex="~ col gap-3">
          <fieldset
            v-if="persistedWebSearchProvidersMetadata.length > 0"
            class="settings-provider-card-strip"
            min-w-0
            role="radiogroup"
          >
            <RadioCardSimple
              v-for="metadata in persistedWebSearchProvidersMetadata"
              :id="metadata.id"
              :key="metadata.id"
              v-model="activeProvider"
              class="settings-provider-card-item"
              name="web-search-provider"
              :value="metadata.id"
              :title="metadata.localizedName || 'Unknown'"
              :description="metadata.localizedDescription"
            >
              <template #topRight>
                <button
                  type="button"
                  :class="iconButtonClass"
                  @click.stop.prevent="handleDeleteProvider(metadata.id)"
                >
                  <div i-solar:trash-bin-trash-bold-duotone class="text-base" />
                </button>
              </template>

              <template v-if="configuredProviders[metadata.id] === false" #bottomRight>
                <div class="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 font-medium dark:bg-amber-900/30 dark:text-amber-300">
                  健康检查失败
                </div>
              </template>
            </RadioCardSimple>
            <RouterLink
              to="/settings/providers#web-search"
              :class="addProviderCardClass"
            >
              <div :class="addProviderIconClass" />
              <div
                class="absolute inset-0 z--1"
                style="background-image: radial-gradient(var(--airi-border-subtle) 1px, transparent 1px); background-size: 10px 10px; mask-image: linear-gradient(165deg, white 30%, transparent 50%);"
              />
            </RouterLink>
          </fieldset>
          <RouterLink
            v-else
            :class="emptyProviderLinkClass"
            to="/settings/providers#web-search"
          >
            <div i-solar:warning-circle-line-duotone class="text-2xl text-amber-500 dark:text-amber-400" />
            <div class="flex flex-col">
              <span class="font-medium">尚未配置联网搜索服务来源</span>
              <span :class="emptyProviderDescriptionClass">点击这里设置 Tavily 服务来源</span>
            </div>
            <div :class="emptyProviderArrowClass" />
          </RouterLink>

          <div flex="~ gap-2 items-center">
            <Button
              :disabled="!activeProvider || apiKeyValidating"
              @click="testApiKey"
            >
              {{ apiKeyValidating ? '测试中...' : '测试连接' }}
            </Button>

            <div v-if="apiKeyValid === true" flex="~ gap-1 items-center" text="green-600 dark:green-400 sm">
              <div i-solar:check-circle-bold-duotone />
              <span>服务来源可用</span>
            </div>
            <div v-else-if="apiKeyValid === false" flex="~ gap-1 items-center" text="red-600 dark:red-400 sm">
              <div i-solar:close-circle-bold-duotone />
              <span>{{ apiKeyError || '服务来源不可用' }}</span>
            </div>
          </div>
        </div>

        <FieldCheckbox
          v-model="characterProfileEnabled"
          :disabled="!enabled"
          label="启用人设个性化"
          description="不改变搜索主题或丢掉核心结果，只按角色兴趣排序并补充表达"
        />
      </div>

      <!-- Character Profile Settings -->
      <div v-if="enabled && characterProfileEnabled" flex="~ col gap-6">
        <!-- Interest Weights -->
        <div>
          <h3 :class="subsectionTitleClass">
            兴趣偏好权重
          </h3>
          <div :class="subsectionDescriptionClass">
            <span>配置角色对不同内容类型的兴趣程度，只影响同等相关结果的排序和补充角度</span>
          </div>
          <div flex="~ col gap-3">
            <FieldRange
              v-model="interestAnime"
              label="动漫"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="interestMemes"
              label="梗/搞笑"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="interestGames"
              label="游戏"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="interestTechnology"
              label="科技"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="interestArt"
              label="艺术"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="interestMusic"
              label="音乐"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="interestFood"
              label="美食"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="interestFashion"
              label="时尚"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="interestScience"
              label="科学"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="interestPhilosophy"
              label="哲学"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="interestSports"
              label="运动"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="interestNews"
              label="新闻时事"
              :min="0"
              :max="1"
              :step="0.05"
            />
          </div>
        </div>

        <!-- Depth Preferences -->
        <div>
          <h3 :class="subsectionTitleClass">
            信息深度偏好
          </h3>
          <div :class="subsectionDescriptionClass">
            <span>配置角色对不同深度信息的偏好（总和应接近 1.0）</span>
          </div>
          <div flex="~ col gap-3">
            <FieldRange
              v-model="depthSuperficial"
              label="表面/趣味性"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="depthModerate"
              label="中等深度"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="depthDeep"
              label="深度/专业"
              :min="0"
              :max="1"
              :step="0.05"
            />
          </div>
        </div>

        <!-- Expression Style -->
        <div>
          <h3 :class="subsectionTitleClass">
            表达风格偏好
          </h3>
          <div :class="subsectionDescriptionClass">
            <span>配置角色的表达风格倾向</span>
          </div>
          <div flex="~ col gap-3">
            <FieldRange
              v-model="styleCute"
              label="可爱"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="stylePlayful"
              label="玩味"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="styleSerious"
              label="严肃"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="styleCasual"
              label="随意"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="styleProfessional"
              label="专业"
              :min="0"
              :max="1"
              :step="0.05"
            />
            <FieldRange
              v-model="styleEmotional"
              label="情感化"
              :min="0"
              :max="1"
              :step="0.05"
            />
          </div>
        </div>
      </div>

      <!-- Behavior Settings -->
      <div v-if="enabled" flex="~ col gap-6">
        <div>
          <h3 :class="subsectionTitleClass">
            查询行为设置
          </h3>
          <div flex="~ col gap-3">
            <FieldRange
              v-model="knowledgeTransparency"
              label="知识来源透明度"
              description="0 = 隐藏来源，1 = 明确说明查询了信息"
              :min="0"
              :max="1"
              :step="0.1"
            />
            <FieldCheckbox
              v-model="pretendUncertainty"
              label="装不太懂"
              description="即使查到准确信息，也用试探性语气表达"
            />
          </div>
        </div>
      </div>

      <!-- Info Alert -->
      <Alert type="info">
        <template #title>
          关于智能联网系统
        </template>
        <template #description>
          <div flex="~ col gap-2">
            <p>智能联网系统会根据对话情境自动判断是否需要查询信息，而不是简单的关键词触发。</p>
            <p>人设个性化只对围绕核心问题的结果排序、补充角度和调整表达，不会改变搜索主题或丢掉核心结果。</p>
            <p>这让 AI 的联网行为更加自然、有个性，符合角色设定。</p>
          </div>
        </template>
      </Alert>

      <!-- Reset Button -->
      <div>
        <Button
          @click="webSearchStore.resetToDefaults()"
        >
          恢复默认设置
        </Button>
      </div>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: 智能联网
  subtitle: 设置
  description: 配置智能联网系统和人设过滤
  icon: i-solar:global-bold-duotone
  order: 8
</route>
