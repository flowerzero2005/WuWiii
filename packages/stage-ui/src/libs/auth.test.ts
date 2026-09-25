import type { VerificationCodeRateLimitError } from './auth'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '../stores/auth'
import { bindEmail, changeAccountPassword, createTurtleSoupLaunchUrl, fetchSession, normalizeMainlandPhoneNumber, sendEmailBindingCode, sendEmailSignInCode, sendPhoneRegistrationCode, sendPhoneSignInCode, signInWithEmailCode, signInWithEmailPassword, signInWithPassword, signInWithPhoneCode, signOut, signUpWithEmailPassword } from './auth'

const authClientMock = vi.hoisted(() => ({
  emailOtp: {
    sendVerificationOtp: vi.fn(),
  },
  getSession: vi.fn(),
  listSessions: vi.fn(),
  signIn: {
    email: vi.fn(),
    emailOtp: vi.fn(),
    phoneNumber: vi.fn(),
  },
  changePassword: vi.fn(),
  signOut: vi.fn(),
  signUp: {
    email: vi.fn(),
  },
  phoneNumber: {
    sendOtp: vi.fn(),
    verify: vi.fn(),
  },
}))

vi.mock('better-auth/vue', () => ({
  createAuthClient: vi.fn(() => authClientMock),
}))

const user = {
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  emailVerified: true,
  createdAt: new Date('2026-07-11T00:00:00.000Z'),
  updatedAt: new Date('2026-07-11T00:00:00.000Z'),
}

const session = {
  id: 'session-1',
  userId: 'user-1',
  token: 'token',
  createdAt: new Date('2026-07-11T00:00:00.000Z'),
  updatedAt: new Date('2026-07-11T00:00:00.000Z'),
  expiresAt: new Date('2026-07-12T00:00:00.000Z'),
}

describe('email/password auth helpers', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    authClientMock.signIn.email.mockResolvedValue({ data: { user } })
    authClientMock.signIn.emailOtp.mockResolvedValue({ data: { user } })
    authClientMock.signIn.phoneNumber.mockResolvedValue({ data: { user } })
    authClientMock.changePassword.mockResolvedValue({ data: { status: true } })
    authClientMock.signUp.email.mockResolvedValue({ data: { user } })
    authClientMock.emailOtp.sendVerificationOtp.mockResolvedValue({ data: { success: true } })
    authClientMock.phoneNumber.sendOtp.mockResolvedValue({ data: { message: 'sent' } })
    authClientMock.phoneNumber.verify.mockResolvedValue({ data: { status: true, user } })
    authClientMock.getSession.mockResolvedValue({ data: { user, session } })
  })

  it('signs in with email and refreshes the auth store session', async () => {
    await signInWithEmailPassword({
      email: ' test@example.com ',
      password: 'password-123',
    })

    expect(authClientMock.signIn.email).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'password-123',
    })
    expect(useAuthStore().user?.email).toBe('test@example.com')
  })

  it('signs up with email and refreshes the auth store session', async () => {
    await signUpWithEmailPassword({
      email: ' beta@example.com ',
      name: ' Beta User ',
      password: 'password-123',
    })

    expect(authClientMock.signUp.email).toHaveBeenCalledWith({
      email: 'beta@example.com',
      name: 'Beta User',
      password: 'password-123',
    })
    expect(authClientMock.getSession).toHaveBeenCalled()
  })

  it('rejects invalid sign-in credentials without fetching a session', async () => {
    authClientMock.signIn.email.mockResolvedValue({
      data: null,
      error: { message: 'Invalid email or password' },
    })

    await expect(signInWithEmailPassword({
      email: 'test@example.com',
      password: 'wrong-password',
    })).rejects.toThrow('账号或密码错误。')

    expect(authClientMock.getSession).not.toHaveBeenCalled()
  })

  it('rejects sign-in when the server does not create a session', async () => {
    authClientMock.getSession.mockResolvedValue({ data: null })

    await expect(signInWithEmailPassword({
      email: 'test@example.com',
      password: 'password-123',
    })).rejects.toThrow('登录未能建立会话，请重试。')
  })

  it('signs in with a normalized phone number and password', async () => {
    await signInWithPassword('138 0013 8000', 'password-123')

    expect(authClientMock.signIn.phoneNumber).toHaveBeenCalledWith({
      password: 'password-123',
      phoneNumber: '+8613800138000',
    })
  })

  it('rejects malformed phone identities before sending an email request', async () => {
    await expect(signInWithPassword('138001380', 'password-123')).rejects.toThrow('请输入有效的中国大陆手机号。')
    expect(authClientMock.signIn.email).not.toHaveBeenCalled()
    expect(authClientMock.signIn.phoneNumber).not.toHaveBeenCalled()
  })

  it('changes the account password and revokes other sessions', async () => {
    await changeAccountPassword({ currentPassword: 'old-password', newPassword: 'new-password' })

    expect(authClientMock.changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password',
      newPassword: 'new-password',
      revokeOtherSessions: true,
    })
  })

  it('clears stale auth state when the session is no longer available', async () => {
    const store = useAuthStore()
    store.user = user
    store.session = session
    authClientMock.getSession.mockResolvedValue({ data: null })

    await expect(fetchSession()).resolves.toBe(false)

    expect(store.isAuthenticated).toBe(false)
  })

  it('does not restore a session response that was already in flight when signing out', async () => {
    const store = useAuthStore()
    store.user = user
    store.session = session
    let resolveSession: (value: { data: { session: typeof session, user: typeof user } }) => void
    authClientMock.getSession.mockImplementationOnce(() => new Promise(resolve => resolveSession = resolve))
    authClientMock.signOut.mockResolvedValue({ data: { success: true } })

    const staleRefresh = fetchSession()
    await signOut()
    resolveSession!({ data: { session, user } })
    await staleRefresh

    expect(store.isAuthenticated).toBe(false)
  })

  it('exposes an awaitable initial identity decision', async () => {
    const store = useAuthStore()

    await store.waitUntilReady()

    expect(store.ready).toBe(true)
    expect(store.user?.id).toBe('user-1')
  })

  it('sends and verifies email sign-in codes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    await sendEmailSignInCode(' test@example.com ')
    await signInWithEmailCode({ code: ' 123456 ', email: ' test@example.com ', name: ' Test User ' })

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3000/api/auth/email-otp/send-verification-otp', expect.objectContaining({
      body: JSON.stringify({ email: 'test@example.com', type: 'sign-in' }),
      method: 'POST',
    }))
    expect(authClientMock.signIn.emailOtp).toHaveBeenCalledWith({
      email: 'test@example.com',
      name: 'Test User',
      otp: '123456',
    })
  })

  it('routes official auth API requests through the Electron fetch proxy when available', async () => {
    const browserFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    const electronFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', browserFetch)
    vi.stubGlobal('__AIRI_ELECTRON_FETCH_PROXY__', electronFetch)

    await sendEmailSignInCode('test@example.com')

    expect(electronFetch).toHaveBeenCalledWith('http://127.0.0.1:3000/api/auth/email-otp/send-verification-otp', expect.objectContaining({
      body: JSON.stringify({ email: 'test@example.com', type: 'sign-in' }),
      method: 'POST',
    }))
    expect(browserFetch).not.toHaveBeenCalled()
  })

  it('sends a binding code and refreshes the session after binding an email', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await sendEmailBindingCode(' member@example.com ')
    await bindEmail({ code: ' 123456 ', email: ' member@example.com ' })

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:3000/api/account/email-code', expect.objectContaining({
      body: JSON.stringify({ email: 'member@example.com' }),
      method: 'POST',
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:3000/api/account/email', expect.objectContaining({
      body: JSON.stringify({ code: '123456', email: 'member@example.com' }),
      method: 'POST',
    }))
    expect(authClientMock.getSession).toHaveBeenCalled()
  })

  it('normalizes and verifies mainland mobile numbers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })))
    expect(normalizeMainlandPhoneNumber('138 0013 8000')).toBe('+8613800138000')

    await sendPhoneSignInCode('138 0013 8000')
    await signInWithPhoneCode({ code: '123456', phoneNumber: '13800138000' })

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3000/api/auth/phone-number/send-otp', expect.objectContaining({
      body: JSON.stringify({ phoneNumber: '+8613800138000' }),
      method: 'POST',
    }))
    expect(authClientMock.phoneNumber.verify).toHaveBeenCalledWith({
      code: '123456',
      phoneNumber: '+8613800138000',
    })
  })

  it('preserves verification-code retry timing from the server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'VERIFICATION_CODE_RATE_LIMITED',
      details: { retryAfterSeconds: 37 },
    }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '37' } })))

    await expect(sendEmailSignInCode('test@example.com')).rejects.toEqual(expect.objectContaining<Partial<VerificationCodeRateLimitError>>({
      retryAfterSeconds: 37,
    }))
  })

  it.each([
    ['PHONE_NUMBER_ALREADY_REGISTERED', '该手机号已注册，请直接登录。', () => sendPhoneRegistrationCode('13800138000')],
    ['EMAIL_ALREADY_REGISTERED', '该邮箱已被其他账户使用，请直接登录或更换邮箱。', () => sendEmailBindingCode('used@example.com')],
    ['EMAIL_ALREADY_BOUND', '当前账户已经绑定邮箱。', () => sendEmailBindingCode('new@example.com')],
  ])('localizes the %s verification precheck', async (code, message, action) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: code }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    })))

    await expect(action()).rejects.toThrow(message)
  })

  it('creates a one-time turtle soup launch URL for an authenticated desktop session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ exchangeCode: 'x'.repeat(32) }), { status: 201 })))

    await expect(createTurtleSoupLaunchUrl()).resolves.toBe(`http://127.0.0.1:3001/#airi_exchange=${'x'.repeat(32)}`)
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3000/api/game-auth/exchanges', {
      credentials: 'include',
      method: 'POST',
    })
  })

  it('falls back to the anonymous turtle soup entry when no session is available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))

    await expect(createTurtleSoupLaunchUrl()).resolves.toBe('http://127.0.0.1:3001/')
  })
})
