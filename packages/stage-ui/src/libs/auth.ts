import { emailOTPClient, phoneNumberClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/vue'

import { useAuthStore } from '../stores/auth'
import { broadcastAuthStateChanged } from './auth-sync'

export interface AuthVerificationCapabilities {
  emailOtp: boolean
  phoneOtp: boolean
  registration: boolean
}

interface EmailPasswordCredentials {
  email: string
  password: string
}

interface EmailSignUpCredentials extends EmailPasswordCredentials {
  name: string
}

interface AuthClientErrorResult {
  error?: {
    code?: string
    message?: string
    status?: number
    statusText?: string
  } | null
}

export class AuthSessionRefreshError extends Error {
  constructor(public readonly status?: number) {
    super('Unable to refresh the authentication session.')
    this.name = 'AuthSessionRefreshError'
  }
}

export class VerificationCodeRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Verification code requests are too frequent.')
    this.name = 'VerificationCodeRateLimitError'
  }
}

export const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://127.0.0.1:3000'
const TURTLE_SOUP_URL = import.meta.env.VITE_TURTLE_SOUP_URL || 'http://127.0.0.1:3001/'

function getOfficialApiFetch(): typeof fetch {
  const electronFetch = (globalThis as typeof globalThis & {
    __AIRI_ELECTRON_FETCH_PROXY__?: typeof fetch
  }).__AIRI_ELECTRON_FETCH_PROXY__

  return electronFetch || globalThis.fetch.bind(globalThis)
}

export const authClient = createAuthClient({
  baseURL: SERVER_URL,
  credentials: 'include',
  plugins: [emailOTPClient(), phoneNumberClient()],
})

let sessionRefreshVersion = 0

export function invalidateAuthSession() {
  sessionRefreshVersion += 1
  const authStore = useAuthStore()
  authStore.user = undefined
  authStore.session = undefined
}

function assertAuthSuccess(result: unknown, fallbackMessage: string) {
  if (!result || typeof result !== 'object')
    return

  const error = (result as AuthClientErrorResult).error
  if (!error)
    return

  throw new Error(localizeAuthError(error, fallbackMessage))
}

function localizeAuthError(error: NonNullable<AuthClientErrorResult['error']>, fallbackMessage: string) {
  const code = error.code?.toUpperCase() ?? ''
  if (code === 'PHONE_NUMBER_ALREADY_REGISTERED')
    return localizedMessage('该手机号已注册，请直接登录。', 'This phone number is already registered. Please sign in.')
  if (code === 'EMAIL_ALREADY_REGISTERED')
    return localizedMessage('该邮箱已被其他账户使用，请直接登录或更换邮箱。', 'This email is already in use. Please sign in or use another email.')
  if (code === 'EMAIL_ALREADY_BOUND')
    return localizedMessage('当前账户已经绑定邮箱。', 'This account already has a bound email address.')

  const message = `${error.message || ''} ${error.statusText || ''} ${error.code || ''}`.toLowerCase()

  if (['INVALID_OTP', 'OTP_EXPIRED', 'OTP_NOT_FOUND'].includes(code) || message.includes('invalid otp') || message.includes('invalid code') || message.includes('expired otp') || message.includes('otp expired') || message.includes('otp_expired') || message.includes('otp not found'))
    return '验证码错误或已过期，请重新获取。'
  if (code === 'INVALID_EMAIL_OR_PASSWORD' || code === 'INVALID_PASSWORD' || message.includes('invalid email or password') || message.includes('invalid password'))
    return localizedMessage('账号或密码错误。', 'The account or password is incorrect.')
  if (code === 'INVALID_PHONE_NUMBER_OR_PASSWORD' || message.includes('invalid phone number or password') || message.includes('invalid credentials'))
    return localizedMessage('手机号或密码错误。', 'The phone number or password is incorrect.')
  if (message.includes('user not found') || message.includes('not registered'))
    return localizedMessage('该账号尚未注册。', 'This account is not registered yet.')
  if (code === 'INVALID_PHONE_NUMBER' || (message.includes('phone number') && message.includes('invalid')))
    return localizedMessage('请输入有效的中国大陆手机号。', 'Please enter a valid mainland China phone number.')
  if (message.includes('already registered') || message.includes('user already exists'))
    return '该邮箱已注册，请直接登录。'
  if (message.includes('too many') || message.includes('rate limit'))
    return '请求过于频繁，请稍后再试。'

  return fallbackMessage
}

function localizedMessage(zh: string, en: string) {
  return typeof navigator !== 'undefined' && !navigator.language.toLowerCase().startsWith('zh') ? en : zh
}

async function readAuthResponse(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => ({})) as { error?: string, message?: string, details?: { retryAfterSeconds?: number } }
  if (!response.ok) {
    if (response.status === 429 && payload.error === 'VERIFICATION_CODE_RATE_LIMITED') {
      const seconds = payload.details?.retryAfterSeconds ?? Number.parseInt(response.headers.get('retry-after') ?? '60', 10)
      throw new VerificationCodeRateLimitError(Number.isFinite(seconds) ? seconds : 60)
    }
    throw new Error(localizeAuthError({ code: payload.error, message: payload.message }, payload.message || fallbackMessage))
  }
  return payload
}

export async function fetchSession(options: { broadcast?: boolean } = {}) {
  const refreshVersion = sessionRefreshVersion
  const { data, error } = await authClient.getSession()
  // A response sent before another window signed out must not restore that
  // renderer's old identity after the shared cookie has been revoked.
  if (refreshVersion !== sessionRefreshVersion)
    return false

  const authStore = useAuthStore()
  if (data) {
    authStore.user = data.user
    authStore.session = data.session
    if (options.broadcast)
      broadcastAuthStateChanged()
    return true
  }

  // The client reports a received non-2xx response as data: null with an
  // error. Only a confirmed 401 may revoke the local session; a failed
  // network request or a transient server response must preserve it.
  if (error && error.status !== 401)
    throw new AuthSessionRefreshError(error.status)

  const wasAuthenticated = useAuthStore().isAuthenticated
  invalidateAuthSession()
  if (wasAuthenticated || options.broadcast)
    broadcastAuthStateChanged('sign-out')
  return false
}

export async function listSessions() {
  return await authClient.listSessions()
}

export async function changeAccountPassword(input: { currentPassword: string, newPassword: string }) {
  const result = await authClient.changePassword({
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
    revokeOtherSessions: true,
  })
  assertAuthSuccess(result, '无法修改密码，请确认当前密码是否正确。')
}

export async function signOut() {
  const result = await authClient.signOut()
  assertAuthSuccess(result, '退出登录失败，请重试。')

  invalidateAuthSession()
  broadcastAuthStateChanged('sign-out')
}

export async function signInWithEmailPassword(credentials: EmailPasswordCredentials) {
  const result = await authClient.signIn.email({
    email: credentials.email.trim(),
    password: credentials.password,
  })
  assertAuthSuccess(result, '无法使用该账号和密码登录。')

  if (!await fetchSession({ broadcast: true }))
    throw new Error('登录未能建立会话，请重试。')

  return true
}

export async function signInWithPhonePassword(credentials: { password: string, phoneNumber: string }) {
  const phoneNumber = normalizeMainlandPhoneNumber(credentials.phoneNumber)
  if (!isSupportedPhoneNumber(phoneNumber))
    throw new Error('请输入有效的中国大陆手机号。')
  const result = await authClient.signIn.phoneNumber({ password: credentials.password, phoneNumber })
  assertAuthSuccess(result, '无法使用该账号和密码登录。')
  if (!await fetchSession({ broadcast: true }))
    throw new Error('登录未能建立会话，请重试。')
  return true
}

export async function signInWithPassword(identity: string, password: string) {
  return isPhoneIdentity(identity)
    ? signInWithPhonePassword({ password, phoneNumber: identity })
    : signInWithEmailPassword({ email: identity, password })
}

export async function signUpWithEmailPassword(credentials: EmailSignUpCredentials) {
  const result = await authClient.signUp.email({
    email: credentials.email.trim(),
    name: credentials.name.trim(),
    password: credentials.password,
  })
  assertAuthSuccess(result, '无法创建该账户。')

  if (!await fetchSession({ broadcast: true }))
    throw new Error('Account creation completed without creating a session. Please sign in.')

  return true
}

export function normalizeMainlandPhoneNumber(value: string) {
  const compact = value.trim().replace(/[\s()-]/g, '')
  return /^1[3-9]\d{9}$/.test(compact) ? `+86${compact}` : compact
}

export function isSupportedPhoneNumber(value: string) {
  return /^\+861[3-9]\d{9}$/.test(normalizeMainlandPhoneNumber(value))
}

function isPhoneIdentity(value: string) {
  const compact = value.trim().replace(/[\s()-]/g, '')
  return /^1\d*$/.test(compact) || /^\+?86\d*$/.test(compact)
}

export async function fetchAuthVerificationCapabilities(): Promise<AuthVerificationCapabilities> {
  const response = await getOfficialApiFetch()(`${SERVER_URL}/api/auth/capabilities`, { credentials: 'include' })
  if (!response.ok)
    throw new Error('无法加载可用的登录方式。')

  const data = await response.json() as Partial<AuthVerificationCapabilities>
  return {
    emailOtp: data.emailOtp === true,
    phoneOtp: data.phoneOtp === true,
    registration: data.registration === true,
  }
}

export async function sendPhoneRegistrationCode(phoneNumber: string) {
  const normalized = normalizeMainlandPhoneNumber(phoneNumber)
  if (!isSupportedPhoneNumber(normalized))
    throw new Error('请输入有效的中国大陆手机号。')
  await readAuthResponse(await getOfficialApiFetch()(`${SERVER_URL}/api/account/registration-code`, {
    body: JSON.stringify({ phoneNumber: normalized }),
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  }), '无法发送注册验证码。')
}

export async function registerWithPhone(input: { code: string, confirmPassword: string, name: string, password: string, phoneNumber: string }) {
  const phoneNumber = normalizeMainlandPhoneNumber(input.phoneNumber)
  await readAuthResponse(await getOfficialApiFetch()(`${SERVER_URL}/api/account/register`, {
    body: JSON.stringify({ ...input, phoneNumber, termsAccepted: true }),
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  }), '无法创建账户。')
  await signInWithPhonePassword({ password: input.password, phoneNumber })
}

export async function sendEmailBindingCode(email: string) {
  await readAuthResponse(await getOfficialApiFetch()(`${SERVER_URL}/api/account/email-code`, {
    body: JSON.stringify({ email: email.trim() }),
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  }), '无法发送邮箱验证码。')
}

export async function bindEmail(input: { code: string, email: string }) {
  await readAuthResponse(await getOfficialApiFetch()(`${SERVER_URL}/api/account/email`, {
    body: JSON.stringify({ code: input.code.trim(), email: input.email.trim() }),
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  }), '无法绑定邮箱。')
  await fetchSession({ broadcast: true })
}

export async function createTurtleSoupLaunchUrl() {
  try {
    const response = await getOfficialApiFetch()(`${SERVER_URL}/api/game-auth/exchanges`, {
      credentials: 'include',
      method: 'POST',
    })
    if (!response.ok)
      return TURTLE_SOUP_URL

    const data = await response.json() as { exchangeCode?: unknown }
    return typeof data.exchangeCode === 'string' && data.exchangeCode.length >= 32
      ? `${TURTLE_SOUP_URL}#airi_exchange=${encodeURIComponent(data.exchangeCode)}`
      : TURTLE_SOUP_URL
  }
  catch {
    return TURTLE_SOUP_URL
  }
}

export async function sendEmailSignInCode(email: string) {
  await readAuthResponse(await getOfficialApiFetch()(`${SERVER_URL}/api/auth/email-otp/send-verification-otp`, {
    body: JSON.stringify({ email: email.trim(), type: 'sign-in' }),
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  }), '无法发送邮箱验证码。')
}

export async function signInWithEmailCode(credentials: { code: string, email: string, name?: string }) {
  const result = await authClient.signIn.emailOtp({
    email: credentials.email.trim(),
    name: credentials.name?.trim() || undefined,
    otp: credentials.code.trim(),
  })
  assertAuthSuccess(result, '无法验证邮箱验证码。')

  if (!await fetchSession({ broadcast: true }))
    throw new Error('登录未能建立会话，请重试。')
}

export async function sendPhoneSignInCode(phoneNumber: string) {
  const normalizedPhoneNumber = normalizeMainlandPhoneNumber(phoneNumber)
  if (!isSupportedPhoneNumber(normalizedPhoneNumber))
    throw new Error('请输入有效的中国大陆手机号。')

  await readAuthResponse(await getOfficialApiFetch()(`${SERVER_URL}/api/auth/phone-number/send-otp`, {
    body: JSON.stringify({ phoneNumber: normalizedPhoneNumber }),
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  }), '无法发送短信验证码。')
}

export async function signInWithPhoneCode(credentials: { code: string, phoneNumber: string }) {
  const phoneNumber = normalizeMainlandPhoneNumber(credentials.phoneNumber)
  if (!isSupportedPhoneNumber(phoneNumber))
    throw new Error('请输入有效的中国大陆手机号。')

  const result = await authClient.phoneNumber.verify({
    code: credentials.code.trim(),
    phoneNumber,
  })
  assertAuthSuccess(result, '无法验证短信验证码。')

  if (!await fetchSession({ broadcast: true }))
    throw new Error('登录未能建立会话，请重试。')
}
