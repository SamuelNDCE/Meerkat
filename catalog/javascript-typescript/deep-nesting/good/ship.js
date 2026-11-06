export function ship(order) {
  const steps = [step0, step1, step2, step3, step4, step5, step6, step7]
  for (const check of steps) {
    if (!check(order)) return null
  }
  return dispatch(order)
}
