import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import IntroScene from '../components/intro/IntroScene'

export default function IntroPage() {
  const navigate = useNavigate()

  // If user already saw the intro this session, skip straight to app
  useEffect(() => {
    if (sessionStorage.getItem('pt_skip_intro') === '1') {
      navigate('/app', { replace: true })
    }
  }, [navigate])

  const handleEnter = useCallback(() => {
    sessionStorage.setItem('pt_skip_intro', '1')
    navigate('/app')
  }, [navigate])

  return <IntroScene onEnter={handleEnter} />
}
