export function resolveProviderResourceLabel(
  providerId: string | undefined,
  resource: 'models' | 'voices',
  resourceId: string | undefined,
  resourceName: string | undefined,
  translate: (key: string) => string,
  hasTranslation: (key: string, locale?: string) => boolean,
) {
  if (!resourceId)
    return ''

  const publicResourceName = resourceName?.trim()
  if (publicResourceName && publicResourceName !== resourceId && !/\bairi\b/i.test(publicResourceName))
    return publicResourceName

  if (providerId) {
    const translationKey = `settings.pages.providers.provider.${providerId}.${resource}.${resourceId}`
    if (hasTranslation(translationKey) || hasTranslation(translationKey, 'en'))
      return translate(translationKey)
  }

  return publicResourceName || resourceId
}
