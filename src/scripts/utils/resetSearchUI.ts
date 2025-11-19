export function resetSearchUI({
	input,
	resultsRow,
	resultsWrap,
	artistAlbumsRow,
	artistAlbumsWrap,
}: {
	input: HTMLInputElement
	resultsRow: HTMLElement
	resultsWrap: HTMLElement
	artistAlbumsRow?: HTMLElement | null
	artistAlbumsWrap?: HTMLElement | null
}) {
	input.value = ''
	resultsRow.innerHTML = ''
	resultsWrap.hidden = true

	if (artistAlbumsRow) artistAlbumsRow.innerHTML = ''
	if (artistAlbumsWrap) artistAlbumsWrap.hidden = true
}
