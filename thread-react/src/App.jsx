import React from 'react'
import ThreadShell from './components/ThreadShell.jsx'
import useThreadScripts from './useThreadScripts.js'

export default function App() {
  useThreadScripts()
  return <ThreadShell />
}
