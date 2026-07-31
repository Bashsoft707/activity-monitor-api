import { io, type Socket } from 'socket.io-client'

/** Connects a client and resolves once the handshake completes. */
export const connectClient = (url: string): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['websocket'], reconnection: false })
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error(`Timed out connecting to ${url}`))
    }, 10_000)

    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(socket)
    })
    socket.once('connect_error', (error) => {
      clearTimeout(timer)
      socket.close()
      reject(error)
    })
  })

/** Resolves with the first payload delivered on `name`, or rejects on timeout. */
export const waitForEvent = <T>(socket: Socket, name: string, timeoutMs = 8_000): Promise<T> =>
  new Promise((resolve, reject) => {
    const handler = (payload: T): void => {
      clearTimeout(timer)
      resolve(payload)
    }
    const timer = setTimeout(() => {
      socket.off(name, handler)
      reject(new Error(`Timed out waiting for "${name}"`))
    }, timeoutMs)

    socket.once(name, handler)
  })

/**
 * Resolves if `name` stays silent for the whole window, rejects the moment it
 * fires. Proving an event does *not* arrive needs a wait — there is no other way
 * to distinguish "never sent" from "not sent yet".
 */
export const expectSilence = (socket: Socket, name: string, windowMs = 700): Promise<void> =>
  new Promise((resolve, reject) => {
    const handler = (): void => {
      clearTimeout(timer)
      reject(new Error(`Expected no "${name}", but it was received`))
    }
    const timer = setTimeout(() => {
      socket.off(name, handler)
      resolve()
    }, windowMs)

    socket.once(name, handler)
  })

/** Closes every socket and waits for the disconnects to land server-side. */
export const closeAll = async (...sockets: Array<Socket | undefined>): Promise<void> => {
  for (const socket of sockets) socket?.close()
  await new Promise((resolve) => setTimeout(resolve, 100))
}
