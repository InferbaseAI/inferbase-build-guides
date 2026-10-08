import next from 'eslint-config-next'

const config = [...next, { ignores: ['.next/**', 'data/**'] }]

export default config
