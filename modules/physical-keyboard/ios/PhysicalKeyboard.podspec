Pod::Spec.new do |s|
  s.name = 'PhysicalKeyboard'
  s.version = '1.0.0'
  s.summary = 'Muxify physical keyboard connection state'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Muxify'
  s.homepage = 'https://github.com/muxify-dev/muxify-mobile'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'GameController'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
