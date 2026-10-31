# Deliberately broken: 1 is not equal to 2, so the example must fail.
RSpec.describe 'arithmetic' do
  it 'fails on purpose' do
    expect(1).to eq(2)
  end
end
