import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface SpiralTunnelProps {
  /** 0–1: how far the camera has travelled along the spiral */
  progress: number
  /** independent time for continuous rotation */
  time: number
}

const TURNS = 6
const RADIUS = 2.2
const HEIGHT = 16
const POINTS_COUNT = 800
const TUBE_SEGMENTS = 4

export default function SpiralTunnel({ progress, time }: SpiralTunnelProps) {
  const groupRef = useRef<THREE.Group>(null!)
  const tubeRef = useRef<THREE.Mesh>(null!)

  // ── Build helical path ────────────────────────────────────────
  const curve = useMemo(() => {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= POINTS_COUNT; i++) {
      const t = i / POINTS_COUNT
      const angle = t * TURNS * Math.PI * 2
      const y = t * HEIGHT - HEIGHT / 2
      pts.push(new THREE.Vector3(
        Math.cos(angle) * RADIUS,
        y,
        Math.sin(angle) * RADIUS,
      ))
    }
    return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5)
  }, [])

  // ── Tube geometry (the glowing helical tunnel wall) ───────────
  const tubeGeo = useMemo(
    () => new THREE.TubeGeometry(curve, 300, 0.04, TUBE_SEGMENTS, false),
    [curve],
  )

  // ── Particle positions along spine ────────────────────────────
  const particles = useMemo(() => {
    const count = 220
    const positions = new Float32Array(count * 3)
    const sizes = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const t = Math.random()
      const pt = curve.getPoint(t)
      const scatter = (Math.random() - 0.5) * 1.4
      positions[i * 3]     = pt.x + scatter
      positions[i * 3 + 1] = pt.y + (Math.random() - 0.5) * 2
      positions[i * 3 + 2] = pt.z + scatter
      sizes[i] = Math.random() * 4 + 1
    }
    return { positions, sizes, count }
  }, [curve])

  const partGeo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(particles.positions, 3))
    g.setAttribute('size', new THREE.BufferAttribute(particles.sizes, 1))
    return g
  }, [particles])

  // ── Animate: camera follows curve, group rotates ──────────────
  useFrame(({ camera }) => {
    // Camera rides along the curve based on scroll progress
    const camT = Math.max(0.001, Math.min(0.999, progress * 0.9 + 0.02))
    const camPos = curve.getPoint(camT)
    const lookT  = Math.min(0.999, camT + 0.015)
    const lookAt = curve.getPoint(lookT)

    camera.position.lerp(camPos, 0.08)
    camera.lookAt(lookAt)

    // Group continuously rotates around Y
    if (groupRef.current) {
      groupRef.current.rotation.y = time * 0.18
    }
  })

  return (
    <group ref={groupRef}>
      {/* ── Helical tube ── */}
      <mesh ref={tubeRef} geometry={tubeGeo}>
        <meshStandardMaterial
          color="#818cf8"
          emissive="#4f46e5"
          emissiveIntensity={1.6}
          transparent
          opacity={0.72}
          wireframe={false}
          roughness={0.1}
          metalness={0.4}
        />
      </mesh>

      {/* ── Inner glow ring copies at 3 offsets ── */}
      {[0.25, 0.5, 0.75].map((offset, i) => (
        <mesh key={i} geometry={tubeGeo}>
          <meshStandardMaterial
            color="#c084fc"
            emissive="#7c3aed"
            emissiveIntensity={0.5 - i * 0.12}
            transparent
            opacity={0.15}
          />
        </mesh>
      ))}

      {/* ── Floating particles ── */}
      <points geometry={partGeo}>
        <pointsMaterial
          color="#a5b8fc"
          size={0.06}
          transparent
          opacity={0.7}
          sizeAttenuation
        />
      </points>

      {/* ── Ambient lighting ── */}
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 4, 0]} intensity={2} color="#818cf8" distance={12} />
      <pointLight position={[0, -4, 0]} intensity={1.5} color="#c084fc" distance={12} />
    </group>
  )
}
