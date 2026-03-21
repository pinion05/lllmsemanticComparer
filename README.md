# LLLM Semantic Comparer

## TL;DR

- HTML 압축 자동연구를 하다가, 압축기보다 먼저 의미 보존을 안정적으로 판정하는 평가기가 필요해서 분리된 프로젝트입니다.
- 기본 전략은 같은 문서쌍을 5회 평가해 `trimean`으로 집계하는 `sampling`입니다.
- 비교군으로는 관점별 단일책임 분석기를 병렬 실행해 취합하는 `single_responsibility_ensemble`도 지원합니다.
- 현재 비교 연구 기준으로는 **ensemble이 토큰 사용량은 거의 절반**이지만, **점수 안정성은 sampling이 여전히 강하거나 최소 동급**입니다.

## 권장 README 구조안

이 README를 더 읽기 쉽게 유지하려면 아래 구조가 가장 자연스럽습니다.

1. TL;DR
2. 빠른 실행 방법
3. 이 도구가 하는 일
4. 출력 해석
5. 평가 전략과 수학 로직
6. 핵심 결과 요약
7. 비교 연구 / 상세 실험 기록
8. 예제 케이스
9. 한계

이번 리라이트도 이 구조를 기준으로 적용했습니다.

## 빠른 실행 방법

### Requirements

- Node.js 18+
- `OPENROUTER_API_KEY`
- `OPENROUTER_DEFAULT_MODEL`

### Setup

`~/.zshrc` 같은 셸 설정 파일에 아래처럼 넣어두면 됩니다. 현재 프로세스 환경변수가 비어 있으면 이 CLI가 `~/.zshrc`에서 `OPENROUTER_API_KEY`, `OPENROUTER_DEFAULT_MODEL`을 fallback으로 읽습니다.

```bash
export OPENROUTER_API_KEY=your_key_here
export OPENROUTER_DEFAULT_MODEL=nvidia/nemotron-3-nano-30b-a3b:free
```

적용 후에는 `source ~/.zshrc`를 실행하거나 새 셸을 열면 됩니다.

의존성은 없습니다. 바로 실행하면 됩니다.

### Usage

기본 실행:

```bash
npm run compare -- ./doc-a.txt ./doc-b.txt
```

JSON 결과:

```bash
npm run compare -- ./doc-a.txt ./doc-b.txt --json
```

모델 강제 지정:

```bash
npm run compare -- ./doc-a.txt ./doc-b.txt --model nvidia/nemotron-3-nano-30b-a3b:free
```

단일책임 관점 앙상블:

```bash
npm run compare -- ./doc-a.txt ./doc-b.txt \
  --strategy single_responsibility_ensemble \
  --perspective-model semantic=<model-id> \
  --perspective-model info=<model-id> \
  --perspective-model coverage_a=<model-id> \
  --perspective-model coverage_b=<model-id>
```

`--perspective-model`에는 원하는 OpenRouter 모델 ID를 자유롭게 넣을 수 있습니다.

저장소 예제로 시험:

```bash
npm run compare -- ./examples/highly-equivalent-a.txt ./examples/highly-equivalent-b.txt
```

여러 예제를 한 번에 실행:

```bash
npm run example-suite
```

## 이 도구가 하는 일

두 문서를 읽고 OpenRouter 기반 LLM으로 다음을 평가합니다.

- 의미가 얼마나 같은지
- 정보량이 얼마나 비슷한지
- 어느 방향으로 정보가 빠졌는지
- 최종적으로 어느 정도 동등하다고 볼 수 있는지

핵심 지표는 다음 네 가지입니다.

- `semantic_similarity`
- `information_amount_parity`
- `doc_a_coverage_by_doc_b`
- `doc_b_coverage_by_doc_a`

그리고 이 네 지표를 바탕으로 최종 `overall_equivalence`와 `verdict`를 계산합니다.

## 왜 이런 도구가 필요한가

HTML 압축 자동연구에서는 압축률만 보면 안 됩니다. 토큰 수가 줄어도 중요한 날짜, 숫자, 책임자, 조건, 예외, 지표가 빠지면 실패입니다. 반대로 표현만 달라지고 사실은 그대로 남아 있으면 좋은 압축일 수 있습니다.

그래서 이 도구는 "얼마나 짧아졌는가"보다 아래 질문을 보도록 설계했습니다.

- 원본과 압축본이 같은 사건, 결정, 사실을 말하는가
- 압축 과정에서 어떤 정보가 빠졌는가
- 빠진 정보가 사소한가, 아니면 핵심인가
- 같은 입력을 반복 평가했을 때 결과가 어느 정도 안정적인가

핵심 문제의식은 간단합니다. 생성기보다 먼저, 생성 결과를 비교하고 걸러낼 수 있는 평가기가 필요하다는 점입니다.

## 출력 해석

기본 텍스트 출력에는 다음이 포함됩니다.

- 전략 정보 (`sampling` 또는 `single_responsibility_ensemble`)
- `sampling`에서는 5회 샘플링 결과와 `trimean` 집계 정보
- `single_responsibility_ensemble`에서는 관점별 실행 모델 목록
- `overall_equivalence`
- `semantic_similarity`
- `information_amount_parity`
- `doc_a_coverage_by_doc_b`
- `doc_b_coverage_by_doc_a`
- 대표 summary
- 공통 정보 / A에만 있는 정보 / B에만 있는 정보 / gap notes

대체로 이렇게 읽으면 됩니다.

- `semantic_similarity`가 높다
  - 같은 의미를 말하고 있을 가능성이 큽니다.
- `information_amount_parity`가 낮다
  - 한쪽이 훨씬 더 자세합니다.
- `A->B coverage`가 낮고 `B->A coverage`가 높다
  - B가 A를 압축한 형태일 가능성이 큽니다.
- `semantic_similarity`도 낮고 coverage도 낮다
  - 사실상 의미가 많이 깨진 것입니다.

## 평가 전략

### 1) 기본 전략: `sampling`

한 번의 비교는 내부적으로 이렇게 진행됩니다.

1. 같은 문서쌍을 5번 평가합니다.
2. 각 실행에서 semantic, info parity, 양방향 coverage를 얻습니다.
3. 각 수치를 `trimean`으로 집계합니다.
4. 집계된 수치로 `overall_equivalence`와 `verdict`를 계산합니다.
5. 집계 점수 벡터에 가장 가까운 실행 1개를 대표 run으로 골라 summary와 포인트 목록에 사용합니다.

이 구조는 "설명 가능한 점수"와 "반복 실행 안정성" 사이의 균형을 맞추기 위해 선택했습니다.

### 2) 비교군 전략: `single_responsibility_ensemble`

샘플링 기반 기본 전략 외에, 비교군으로 `single_responsibility_ensemble`도 지원합니다.

이 모드에서는 4개의 독립 분석기를 병렬 실행합니다.

- `semantic_similarity`
- `information_amount_parity`
- `doc_a_coverage_by_doc_b`
- `doc_b_coverage_by_doc_a`

각 분석기는 자기 점수 하나에만 집중하고, 최종 `overall_equivalence`와 `verdict`는 기존과 동일한 수학식으로 다시 계산합니다.

필요하면 관점별로 다른 모델을 붙일 수 있습니다.

## 합산 수학 로직

### 1. `trimean` 집계

5개 값을 정렬해서:

- `Q1 = 두 번째 값`
- `Median = 세 번째 값`
- `Q3 = 네 번째 값`

그 다음 아래 식으로 집계합니다.

```text
trimean = (Q1 + 2 * Median + Q3) / 4
```

즉 5개 중 가운데 3개를 더 신뢰하고, 특히 중앙값에 2배 가중치를 줍니다.

### 2. overall score 계산

집계된 4개 점수로 최종 `overall_equivalence`를 계산합니다.

```text
overall =
  0.50 * semantic_similarity +
  0.15 * information_amount_parity +
  0.175 * doc_a_coverage_by_doc_b +
  0.175 * doc_b_coverage_by_doc_a
```

마지막에는 0~100 범위로 clamp하고 정수 반올림합니다.

가중치 의도:
- 의미 유사도는 가장 중요하므로 50%
- 정보량 유사도는 중요하지만 의미보다 낮게 15%
- 양방향 coverage는 각각 17.5%

### 3. verdict 계산

최종 verdict는 LLM의 자유 판단이 아니라 집계된 점수에서 규칙적으로 결정합니다.

- `highly_equivalent`
  - `semantic >= 92`
  - `info_parity >= 90`
  - `min(coverage_a_to_b, coverage_b_to_a) >= 90`

- `mostly_equivalent`
  - `semantic >= 80`
  - `overall >= 74`
  - `info_parity >= 70`
  - `min(coverage_a_to_b, coverage_b_to_a) >= 75`

- `partially_equivalent`
  - `semantic >= 40`
  - `overall >= 35`

- 그 외는 `materially_different`

### 4. 요약 문장 선택

summary, shared points, gap notes 같은 서술형 필드는 5개 실행 중에서 집계된 점수 벡터에 가장 가까운 실행 1개를 대표 run으로 골라 사용합니다.

## 핵심 결과 요약

아래 값들은 저장소 예제 파일들로 실제 CLI를 실행해 얻은 기록입니다. 모델과 시점에 따라 약간 변할 수 있지만, 현재 도구가 어떤 식으로 반응하는지 보여주는 기준선입니다.

### 원본 / preserved / compressed / lost 세트

원본 파일:
- [source-original.txt](./examples/source-original.txt)

비교 결과:

| case | overall | semantic | info parity | A->B | B->A | verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| preserved | 97 | 97 | 96 | 98 | 98 | highly_equivalent |
| compressed | 84 | 88 | 70 | 72 | 96 | partially_equivalent |
| lost | 40 | 38 | 28 | 14 | 81 | materially_different |

읽는 법:
- `preserved`는 거의 완전한 패러프레이즈로 잘 인식됐습니다.
- `compressed`는 핵심 의미는 강하게 남았지만 세부 운영 정보가 빠져 info parity와 A->B coverage가 내려갔습니다.
- `lost`는 원본의 구체 정보 대부분이 사라져 materially different로 떨어졌습니다.

## 비교 연구

### 비교 연구 1: 1회 실행 기준 `sampling` vs `single_responsibility_ensemble`

실행 시점:
- 2026-03-21
- 모델: `nvidia/nemotron-3-nano-30b-a3b:free` (`OPENROUTER_DEFAULT_MODEL`)

같은 예제 세트를 두 전략으로 각각 한 번씩 실행한 결과는 아래와 같았습니다.

| case | sampling overall | ensemble overall | sampling semantic | ensemble semantic | sampling info | ensemble info | sampling A->B | ensemble A->B | sampling B->A | ensemble B->A | verdict sampling | verdict ensemble | tokens sampling | tokens ensemble |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: |
| highly-equivalent | 96 | 95 | 97 | 97 | 96 | 92 | 96 | 92 | 96 | 96 | highly_equivalent | highly_equivalent | 12160 | 6095 |
| info-gap | 81 | 84 | 86 | 88 | 81 | 87 | 70 | 70 | 79 | 85 | partially_equivalent | partially_equivalent | 14001 | 6199 |
| partial-overlap | 80 | 73 | 85 | 72 | 92 | 88 | 69 | 72 | 69 | 65 | partially_equivalent | partially_equivalent | 12393 | 5530 |
| materially-different | 21 | 21 | 10 | 10 | 93 | 92 | 5 | 5 | 5 | 5 | materially_different | materially_different | 10700 | 5257 |

1회 실행 관찰:
- 4개 예제 모두에서 verdict는 동일했습니다.
- ensemble은 모든 케이스에서 토큰 사용량이 거의 절반 수준이었습니다.
- 다만 `partial-overlap` 같은 경계 사례에서는 ensemble이 더 보수적인 점수를 냈습니다.

### 비교 연구 2: 3회 반복 실행 기준 안정성/토큰 비교

같은 날짜, 같은 모델(`nvidia/nemotron-3-nano-30b-a3b:free`)에서 각 전략을 **케이스별 3회 반복 실행**한 결과입니다.

원본 상세 JSON은 다음 파일에 저장했습니다.
- [`.omx/benchmark-3x-sampling-vs-ensemble.json`](./.omx/benchmark-3x-sampling-vs-ensemble.json)

#### 3회 반복 요약

| case | sampling overall band | ensemble overall band | sampling verdicts | ensemble verdicts | avg tokens sampling | avg tokens ensemble |
| --- | ---: | ---: | --- | --- | ---: | ---: |
| highly-equivalent | 1 | 1 | highly_equivalent | highly_equivalent, mostly_equivalent | 10564.7 | 5211.3 |
| info-gap | 4 | 7 | partially_equivalent, mostly_equivalent | mostly_equivalent, partially_equivalent | 14622.3 | 6278.0 |
| partial-overlap | 6 | 7 | partially_equivalent | partially_equivalent | 11988.7 | 5652.0 |
| materially-different | 0 | 2 | materially_different | materially_different | 10668.3 | 4917.7 |

#### `highly-equivalent` 상세

| strategy | run | overall | semantic | info | A->B | B->A | verdict | total tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| sampling | 1 | 97 | 97 | 96 | 98 | 98 | highly_equivalent | 11100 |
| sampling | 2 | 97 | 97 | 97 | 96 | 96 | highly_equivalent | 10698 |
| sampling | 3 | 96 | 97 | 96 | 96 | 96 | highly_equivalent | 9896 |
| ensemble | 1 | 96 | 98 | 96 | 85 | 100 | mostly_equivalent | 5896 |
| ensemble | 2 | 97 | 98 | 96 | 98 | 95 | highly_equivalent | 4524 |
| ensemble | 3 | 97 | 98 | 96 | 96 | 98 | highly_equivalent | 5214 |

#### `info-gap` 상세

| strategy | run | overall | semantic | info | A->B | B->A | verdict | total tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| sampling | 1 | 81 | 82 | 82 | 70 | 91 | partially_equivalent | 14616 |
| sampling | 2 | 85 | 87 | 70 | 85 | 90 | mostly_equivalent | 14430 |
| sampling | 3 | 82 | 86 | 76 | 71 | 84 | partially_equivalent | 14821 |
| ensemble | 1 | 82 | 82 | 85 | 75 | 85 | mostly_equivalent | 6286 |
| ensemble | 2 | 78 | 85 | 85 | 45 | 85 | partially_equivalent | 6628 |
| ensemble | 3 | 85 | 88 | 88 | 65 | 92 | partially_equivalent | 5920 |

#### `partial-overlap` 상세

| strategy | run | overall | semantic | info | A->B | B->A | verdict | total tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| sampling | 1 | 81 | 85 | 91 | 71 | 69 | partially_equivalent | 11978 |
| sampling | 2 | 75 | 74 | 86 | 75 | 68 | partially_equivalent | 12062 |
| sampling | 3 | 75 | 75 | 89 | 70 | 70 | partially_equivalent | 11926 |
| ensemble | 1 | 69 | 73 | 85 | 70 | 45 | partially_equivalent | 6042 |
| ensemble | 2 | 76 | 72 | 88 | 85 | 68 | partially_equivalent | 5745 |
| ensemble | 3 | 70 | 68 | 85 | 65 | 65 | partially_equivalent | 5169 |

#### `materially-different` 상세

| strategy | run | overall | semantic | info | A->B | B->A | verdict | total tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| sampling | 1 | 20 | 10 | 86 | 7 | 7 | materially_different | 11159 |
| sampling | 2 | 20 | 10 | 90 | 5 | 5 | materially_different | 10341 |
| sampling | 3 | 20 | 10 | 85 | 6 | 6 | materially_different | 10505 |
| ensemble | 1 | 21 | 12 | 85 | 10 | 5 | materially_different | 5079 |
| ensemble | 2 | 20 | 10 | 85 | 5 | 10 | materially_different | 4522 |
| ensemble | 3 | 19 | 15 | 65 | 5 | 5 | materially_different | 5152 |

현재까지의 해석:
- **토큰 사용량**은 ensemble이 꽤 일관되게 절반 수준입니다.
- **실행 완주율**은 파서 보정 이후 `sampling`과 `ensemble` 모두 예제 세트를 끝까지 처리했습니다.
- **점수 안정성**은 아직 ensemble 우위라고 보기 어렵습니다. 케이스에 따라 같거나, 조금 더 흔들리거나, 보수적으로 나오는 경우가 있었습니다.
- 따라서 현재 비교 연구 기준으로는:
  - 비용/속도 측면은 `single_responsibility_ensemble`이 유리
  - 점수 안정성 측면은 `sampling`이 여전히 강하거나 최소 동급
  - verdict는 두 전략 모두 대체로 일관되지만, 경계 사례에서는 둘 다 뒤집힘 가능성이 남아 있습니다.

## 개선 과정

이 도구는 처음부터 지금처럼 안정적이지 않았습니다. 아래는 같은 경계 사례를 반복 실행하면서 점수 밴드를 좁혀간 기록입니다.

기준 문서쌍:
- [partial-overlap-a.txt](./examples/partial-overlap-a.txt)
- [partial-overlap-b.txt](./examples/partial-overlap-b.txt)

### 초기 상태: 단일 호출 + LLM이 overall / verdict 직접 결정

같은 입력을 5번 돌렸을 때:

- overall: `65, 70, 65, 70, 78`
- semantic: `70, 75, 70, 75, 82`
- info parity: `80, 80, 80, 80, 90`
- A->B: `55, 60, 55, 60, 70`
- B->A: `60, 55, 45, 70, 76`
- verdict: `partially_equivalent` 1회, `mostly_equivalent` 4회

밴드:

| metric | min | max | band width |
| --- | ---: | ---: | ---: |
| overall | 65 | 78 | 13 |
| semantic | 70 | 82 | 12 |
| info parity | 80 | 90 | 10 |
| A->B | 55 | 70 | 15 |
| B->A | 45 | 76 | 31 |

문제:
- verdict가 뒤집혔습니다.
- coverage는 특히 많이 흔들렸습니다.
- 경계 사례에서 한 번 실행 결과를 신뢰하기 어려웠습니다.

### 중간 상태: 프롬프트 보수화 + 수학적 calibration

여기서는 LLM이 세부 점수만 내고, `overall`과 `verdict`는 코드에서 재계산하도록 바꿨습니다.

한 실험에서는:

- overall: `71, 72, 72, 81, 64`
- semantic: `70, 72, 70, 85, 70`
- info parity: `85, 85, 85, 92, 85`
- A->B: `65, 65, 70, 70, 45`
- B->A: `65, 65, 70, 70, 45`
- verdict: `partially_equivalent` 4회, `mostly_equivalent` 1회

밴드:

| metric | min | max | band width |
| --- | ---: | ---: | ---: |
| overall | 64 | 81 | 17 |
| semantic | 70 | 85 | 15 |
| info parity | 85 | 92 | 7 |
| A->B | 45 | 70 | 25 |
| B->A | 45 | 70 | 25 |

개선점:
- verdict는 이전보다 덜 흔들렸습니다.
- 하지만 경계 사례 점수 폭은 여전히 넓었습니다.

### 최종 상태: 5회 `trimean` + 수학적 가산

도구 전체를 3번 독립 호출했을 때의 최종 밴드:

| metric | min | max | band width | average |
| --- | ---: | ---: | ---: | ---: |
| overall | 69 | 72 | 3 | 70.7 |
| semantic | 69 | 70 | 1 | 69.7 |
| info parity | 85 | 86 | 1 | 85.3 |
| A->B | 63 | 70 | 7 | 66.3 |
| B->A | 63 | 66 | 3 | 64.7 |

실제 3회 최종 결과:

- call 1: `overall 71`, `semantic 70`, `info 85`, `A->B 66`, `B->A 65`
- call 2: `overall 69`, `semantic 69`, `info 85`, `A->B 63`, `B->A 63`
- call 3: `overall 72`, `semantic 70`, `info 86`, `A->B 70`, `B->A 66`

의미:
- 최종 overall band가 `3점대`로 안착했습니다.
- semantic / info parity는 거의 고정 수준까지 좁아졌습니다.
- coverage는 아직 상대적으로 더 흔들리지만, verdict는 3회 모두 `partially_equivalent`로 유지됐습니다.

## 예제 케이스

저장소에는 연구, 검증, 회귀 확인용 예제가 들어 있습니다.

- 거의 완전한 패러프레이즈
- 핵심은 유지하지만 정보가 많이 압축된 버전
- 일부만 겹치는 버전
- 사실상 다른 의미가 된 버전
- 원본 / preserved / compressed / lost 예제 세트

이 예제들은 프롬프트 조정, verdict 경계 보정, 반복 실행 안정성 확인에 사용했습니다.


## 한계

- LLM 평가이므로 절대적인 진실 판정기는 아닙니다.
- 무료 모델은 rate limit과 응답 포맷 흔들림이 있습니다.
- 현재는 UTF-8 텍스트 입력 기준입니다.
- summary와 bullet 포인트는 대표 실행 1개를 사용하므로, 점수보다 표현이 조금 더 흔들릴 수 있습니다.

그래도 현재 구조는 "압축 후보 여러 개를 자동으로 비교하고, 어떤 방식이 의미 보존에 유리한지 연구하는 용도"에는 꽤 잘 맞습니다.
