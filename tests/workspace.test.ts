/**
 * Undo/redo and project files.
 */

import { describe, expect, it } from 'vitest'

import { Session, type Project } from '../src/core/session'

function seed(): Session {
  const s = new Session()
  s.submit('U=220\\angle 30\\degree\\text{V}')
  s.submit('Z=3+4j')
  s.submit('I=U/Z')
  return s
}

describe('undo and redo', () => {
  it('a fresh session has nothing to undo', () => {
    const s = new Session()
    expect(s.canUndo).toBe(false)
    expect(s.canRedo).toBe(false)
    expect(s.undo()).toBe(false)
    expect(s.redo()).toBe(false)
  })

  it('undo removes the object that was just typed', () => {
    const s = seed()
    expect(s.objects).toHaveLength(3)
    expect(s.undo()).toBe(true)
    expect(s.objects.map((o) => o.name)).toEqual(['U', 'Z'])
    expect(s.canRedo).toBe(true)
  })

  it('redo puts it back, value included', () => {
    const s = seed()
    s.undo()
    expect(s.redo()).toBe(true)
    const i = s.objects.find((o) => o.name === 'I')
    expect(i?.value).not.toBeNull()
    expect(i?.error).toBeUndefined()
  })

  it('undo walks back through several steps', () => {
    const s = seed()
    s.undo()
    s.undo()
    s.undo()
    expect(s.objects).toHaveLength(0)
    expect(s.canUndo).toBe(false)
  })

  it('a new change drops the redo stack', () => {
    const s = seed()
    s.undo()
    s.submit('X=1')
    expect(s.canRedo).toBe(false)
    expect(s.objects.map((o) => o.name)).toEqual(['U', 'Z', 'X'])
  })

  it('a rejected input does not create an undo step', () => {
    const s = seed()
    s.undo()
    const depth = s.canUndo
    const r = s.submit('1+')
    expect(r.ok).toBe(false)
    expect(s.canUndo).toBe(depth)
    expect(s.canRedo).toBe(true)
  })

  it('deleting is undoable', () => {
    const s = seed()
    const id = s.objects[1].id
    s.remove(id)
    expect(s.objects.map((o) => o.name)).toEqual(['U', 'I'])
    s.undo()
    expect(s.objects.map((o) => o.name)).toEqual(['U', 'Z', 'I'])
  })

  it('hiding, clearing, settings and conversion are all undoable', () => {
    const s = seed()

    s.toggleVisible(s.objects[0].id)
    expect(s.objects[0].visible).toBe(false)
    s.undo()
    expect(s.objects[0].visible).toBe(true)

    s.updateSettings({ angleUnit: 'rad' })
    expect(s.settings.angleUnit).toBe('rad')
    s.undo()
    expect(s.settings.angleUnit).toBe('deg')

    s.convertConvention('amplitude')
    expect(s.settings.convention).toBe('amplitude')
    s.undo()
    expect(s.settings.convention).toBe('rms')
    expect(s.objects[0].scale).toBe(1)

    s.clear()
    expect(s.objects).toHaveLength(0)
    s.undo()
    expect(s.objects).toHaveLength(3)
  })

  it('undo restores values, not just names', () => {
    const s = new Session()
    s.submit('U=10')
    s.submit('U=20')
    expect(s.objects[0].value?.re).toBeCloseTo(20, 9)
    s.undo()
    expect(s.objects[0].value?.re).toBeCloseTo(10, 9)
    expect(s.objects[0].latex).toBe('U=10')
  })

  it('undo once re-reads the expression in the restored unit', () => {
    const s = new Session()
    s.submit('P=10\\angle 90')
    s.updateSettings({ angleUnit: 'rad' })
    expect(s.objects[0].value?.im).toBeCloseTo(10 * Math.sin(90), 9)
    s.undo()
    expect(s.settings.angleUnit).toBe('deg')
    expect(s.objects[0].value?.im).toBeCloseTo(10, 9)
  })
})

describe('project files', () => {
  it('round-trips every object, its unit, its factor and its visibility', () => {
    const s = seed()
    s.convertConvention('amplitude')
    s.toggleVisible(s.objects[1].id)

    const file = s.toProject()
    expect(file.app).toBe('phasor-lab')
    expect(file.objects).toHaveLength(3)

    const t = new Session()
    expect(t.loadProject(file)).toBeUndefined()
    expect(t.objects.map((o) => o.name)).toEqual(['U', 'Z', 'I'])
    expect(t.settings.convention).toBe('amplitude')
    expect(t.objects[1].visible).toBe(false)
    expect(t.objects[0].unit).toBe('V')
    expect(t.objects[0].value?.re).toBeCloseTo(s.objects[0].value!.re, 9)
    expect(t.objects[2].value?.im).toBeCloseTo(s.objects[2].value!.im, 9)
  })

  it('survives a JSON round trip', () => {
    const s = seed()
    const text = JSON.stringify(s.toProject())
    const t = new Session()
    expect(t.loadProject(JSON.parse(text) as Project)).toBeUndefined()
    expect(t.objects.map((o) => o.name)).toEqual(['U', 'Z', 'I'])
  })

  it('the stored file is plain readable LaTeX', () => {
    const s = new Session()
    s.submit('U=220\\angle 30\\degree\\text{V}')
    expect(s.toProject().objects[0].latex).toBe('U=220\\angle 30\\degree\\text{V}')
  })

  it('a foreign file is rejected without touching the session', () => {
    const s = seed()
    const r = s.loadProject({ app: 'something-else' } as unknown as Project)
    expect(r?.detail).toBe('bad-project')
    expect(s.objects).toHaveLength(3)
  })

  it('a file whose later object is broken rolls back completely', () => {
    const s = seed()
    const bad: Project = {
      app: 'phasor-lab',
      version: 1,
      settings: s.settings,
      objects: [
        { latex: 'A=1', scale: 1, visible: true },
        { latex: 'B=(', scale: 1, visible: true },
      ],
    }
    const r = s.loadProject(bad)
    expect(r).toBeTruthy()
    expect(s.objects.map((o) => o.name)).toEqual(['U', 'Z', 'I'])
  })

  it('loading costs exactly one undo step', () => {
    const source = seed()
    const file = source.toProject()

    const target = new Session()
    target.submit('Q=5')
    expect(target.loadProject(file)).toBeUndefined()
    expect(target.objects.map((o) => o.name)).toEqual(['U', 'Z', 'I'])
    target.undo()
    expect(target.objects.map((o) => o.name)).toEqual(['Q'])
  })

  it('an empty project is a valid project', () => {
    const s = seed()
    s.loadProject({ app: 'phasor-lab', version: 1, settings: s.settings, objects: [] })
    expect(s.objects).toHaveLength(0)
    expect(s.canUndo).toBe(true)
  })

  it('the settings travel with the file', () => {
    const s = new Session({ angleUnit: 'rad', precision: 8, convention: 'amplitude' })
    s.submit('U=1')
    const t = new Session()
    t.loadProject(s.toProject())
    expect(t.settings).toEqual({ angleUnit: 'rad', precision: 8, convention: 'amplitude' })
  })
})
