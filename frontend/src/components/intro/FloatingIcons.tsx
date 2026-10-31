import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/** Floating file/code icon proxies — icosahedra with emissive colour */
const ICON_DATA = [
  { label: 'train.py',       color: '#818cf8', pos: [ 1.8,  2.0,  0.5] as [number,number,number] },
  { label: 'config.yaml',    color: '#34d399', pos: [-2.0,  1.2, -0.8] as [number,number,number] },
  { label: 'README.md',      color: '#fbbf24', pos: [ 0.5, -1.8,  1.6] as [number,number,number] },
  { label: 'eval.py',        color: '#f472b6', pos: [-1.4, -0.6,  2.0] as [number,number,number] },
  { label: 'dataset.py',     color: '#38bdf8', pos: [ 2.2, -1.0, -1.0] as [number,number,number] },
  { label: 'model.py',       color: '#818cf8', pos: [-0.6,  3.0,  0.2] as [number,number,number] },
  { label: 'requirements',   color: '#a3e635', pos: [ 1.0,  0.4, -2.4] as [number,number,number] },
  { label: 'commit a3f1',    color: '#fb923c', pos: [-1.8,  2.6, -0.4] as [number,number,number] },
]

export default function FloatingIcons() {
  const refs = useRef<(THREE.Mesh | null)[]>([])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    refs.current.forEach((mesh, i) => {
      if (!mesh) return
      mesh.position.y = ICON_DATA[i].pos[1] + Math.sin(t * 0.6 + i * 1.1) * 0.25
      mesh.rotation.x = t * 0.3 + i
      mesh.rotation.y = t * 0.2 + i * 0.7
    })
  })

  return (
    <group>
      {ICON_DATA.map((icon, i) => (
        <mesh
          key={icon.label}
          position={icon.pos}
          ref={el => { refs.current[i] = el }}
        >
          <icosahedronGeometry args={[0.18, 0]} />
          <meshStandardMaterial
            color={icon.color}
            emissive={icon.color}
            emissiveIntensity={0.9}
            transparent
            opacity={0.82}
            roughness={0.2}
            metalness={0.5}
          />
        </mesh>
      ))}
    </group>
  )
}
