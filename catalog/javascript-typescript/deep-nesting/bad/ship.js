export function ship(order) {
  if (step0(order)) {
    if (step1(order)) {
      if (step2(order)) {
        if (step3(order)) {
          if (step4(order)) {
            if (step5(order)) {
              if (step6(order)) {
                if (step7(order)) {
                  return dispatch(order)
                }
              }
            }
          }
        }
      }
    }
  }
  return null
}
