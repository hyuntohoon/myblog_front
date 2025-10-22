// src/components/category-form.tsx
import { useState } from 'react'
import { addCategory } from 'src/lib/api'

export default function CategoryForm() {
	const [name, setName] = useState('')
	const [saving, setSaving] = useState(false)
	async function onSubmit(e: React.FormEvent) {
		e.preventDefault()
		setSaving(true)
		const res = await addCategory(name)
		setSaving(false)
		if (res.ok) setName('')
	}
	return (
		<form onSubmit={onSubmit}>
			<input value={name} onChange={(e) => setName(e.target.value)} />
			<button disabled={saving}>추가</button>
		</form>
	)
}
